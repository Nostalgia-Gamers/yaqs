//! Finds the servers behind one line of the add box: an IP alone scans common
//! ports, "ip:27015-27030" / "ip:27015,27017" checks exactly those.

use crate::a2s;
use crate::addr;
use crate::poller::{now_ms, ServerResult};
use serde::Serialize;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub input: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    pub scan: bool,
    pub servers: Vec<ServerResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

const PARALLEL: usize = 32;

/// With an explicit port list every port is returned (offline ones too, so a
/// server that's down right now can still be added); a scan returns only the
/// servers that answered.
pub async fn discover(input: String) -> Discovery {
    let mut d = Discovery { input: input.clone(), host: None, scan: false, servers: vec![], error: None };
    let target = match addr::parse_target(&input) {
        Ok(t) => t,
        Err(e) => {
            d.error = Some(e.into());
            return d;
        }
    };
    let ip = match addr::resolve_host(&target.host).await {
        Ok(ip) => ip,
        Err(e) => {
            d.error = Some(e.into());
            return d;
        }
    };
    if target.host.parse::<std::net::IpAddr>().is_err() {
        d.host = Some(target.host.clone());
    }
    d.scan = target.scan;

    // Scanning: most ports are empty, so give up quickly. Exact ports: the
    // user named them, so be patient.
    let client = if target.scan {
        a2s::Client::new(Duration::from_secs(1), 0)
    } else {
        a2s::Client::new(Duration::from_millis(1500), 1)
    };
    let slots = Arc::new(Semaphore::new(PARALLEL));
    let mut set = JoinSet::new();
    for port in target.ports {
        let addr = SocketAddr::new(ip, port);
        let client = client.clone();
        let slots = slots.clone();
        set.spawn(async move {
            let _permit = slots.acquire_owned().await.ok();
            (addr, client.info(addr).await)
        });
    }

    let ts = now_ms();
    while let Some(Ok((addr, res))) = set.join_next().await {
        let mut r = ServerResult {
            addr: addr.to_string(),
            online: false,
            ping: 0,
            info: None,
            players: vec![],
            geo: None,
            error: None,
            ts,
            last_seen: None,
        };
        match res {
            Ok((info, rtt)) => {
                r.online = true;
                r.ping = rtt.as_millis() as u32;
                r.info = Some(info);
                r.last_seen = Some(ts);
            }
            Err(_) if target.scan => continue,
            Err(e) => r.error = Some(e.to_string()),
        }
        d.servers.push(r);
    }
    d.servers.sort_by_key(|r| r.addr.parse::<SocketAddr>().map(|a| a.port()).unwrap_or(0));
    d
}

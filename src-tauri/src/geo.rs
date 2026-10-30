//! Country and network of server IPs via ip-api.com's batch endpoint.
//! Lookups never block: `get` returns what's cached and queues the rest.
//! ip-api.com's free tier is non-commercial, HTTP only, 15 batches/minute.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const BATCH_URL: &str = "http://ip-api.com/batch?fields=status,country,countryCode,isp,org,as,query";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoInfo {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub country: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub country_code: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub isp: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub org: String,
    #[serde(default, rename = "as", skip_serializing_if = "String::is_empty")]
    pub asn: String,
}

#[derive(Default)]
struct Cache {
    known: HashMap<IpAddr, Arc<GeoInfo>>,
    pending: HashSet<IpAddr>,
}

#[derive(Clone)]
pub struct Resolver {
    cache: Arc<Mutex<Cache>>,
    http: reqwest::Client,
}

impl Resolver {
    pub fn new() -> Self {
        Resolver {
            cache: Default::default(),
            http: reqwest::Client::builder().timeout(Duration::from_secs(10)).build().expect("http client"),
        }
    }

    /// Cached info for ip, or None after queueing a lookup. LAN IPs are never looked up.
    pub fn get(&self, ip: IpAddr) -> Option<Arc<GeoInfo>> {
        if !crate::addr::is_public(ip) {
            return None;
        }
        let mut c = self.cache.lock().unwrap();
        if let Some(info) = c.known.get(&ip) {
            return Some(info.clone());
        }
        c.pending.insert(ip);
        None
    }

    pub async fn run(self) {
        let mut wait = Duration::from_secs(1);
        loop {
            tokio::time::sleep(wait).await;
            wait = self.flush().await;
        }
    }

    /// Sends one batch; returns how long to wait before the next.
    async fn flush(&self) -> Duration {
        let ips: Vec<IpAddr> = self.cache.lock().unwrap().pending.iter().take(100).copied().collect();
        if ips.is_empty() {
            return Duration::from_secs(2);
        }
        let resp = match self.http.post(BATCH_URL).json(&ips).send().await {
            Ok(r) => r,
            Err(_) => return Duration::from_secs(30),
        };
        // X-Rl: requests left in the window; X-Ttl: seconds until it resets.
        let header = |name: &str| resp.headers().get(name).and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
        let mut next = Duration::from_secs(4);
        if let (Some(rl), Some(ttl)) = (header("X-Rl"), header("X-Ttl")) {
            if rl <= 1 {
                next = Duration::from_secs(ttl + 1);
            }
        }
        if !resp.status().is_success() {
            return next.max(Duration::from_secs(60));
        }

        #[derive(Deserialize)]
        struct Row {
            #[serde(flatten)]
            info: GeoInfo,
            status: String,
            query: String,
        }
        let Ok(rows) = resp.json::<Vec<Row>>().await else { return Duration::from_secs(60) };
        let mut c = self.cache.lock().unwrap();
        for row in rows {
            let Ok(ip) = row.query.parse::<IpAddr>() else { continue };
            // Cache failures too, so unknown IPs aren't retried forever.
            let info = if row.status == "success" { row.info } else { GeoInfo::default() };
            c.known.insert(ip, Arc::new(info));
            c.pending.remove(&ip);
        }
        next
    }
}

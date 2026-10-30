//! Keeps every watched server queried on its own interval and hands batches of
//! results to a sink (the UI). The selected server is watched faster than the
//! rest; the UI just says which interval each address needs.

use crate::a2s::{self, Engine};
use crate::geo::{GeoInfo, Resolver};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Semaphore;

/// The latest known state of one server.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerResult {
    pub addr: String,
    pub online: bool,
    /// Round trip in ms.
    pub ping: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info: Option<a2s::Info>,
    pub players: Vec<a2s::Player>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geo: Option<Arc<GeoInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Unix ms of this result.
    pub ts: u64,
    /// Unix ms of the last successful query.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen: Option<u64>,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Debug, Deserialize)]
pub struct WatchItem {
    pub addr: String,
    /// Seconds between polls.
    pub interval: f64,
}

pub type Sink = Arc<dyn Fn(Vec<Arc<ServerResult>>) + Send + Sync>;

struct Target {
    interval: Duration,
    next: Instant,
    busy: bool,
    fails: u32,
    engine: Engine,
    last: Option<Arc<ServerResult>>,
}

pub struct Config {
    pub min_interval: Duration,
    pub max_inflight: usize,
    /// Consecutive failures before a server that was online is reported down.
    pub fail_threshold: u32,
}

#[derive(Clone)]
pub struct Poller {
    inner: Arc<Inner>,
}

struct Inner {
    client: a2s::Client,
    geo: Option<Resolver>,
    cfg: Config,
    sem: Semaphore,
    targets: Mutex<HashMap<SocketAddr, Target>>,
    pending: Mutex<HashMap<SocketAddr, Arc<ServerResult>>>,
}

impl Poller {
    pub fn new(client: a2s::Client, geo: Option<Resolver>, cfg: Config) -> Self {
        let sem = Semaphore::new(cfg.max_inflight);
        Poller {
            inner: Arc::new(Inner {
                client,
                geo,
                cfg,
                sem,
                targets: Default::default(),
                pending: Default::default(),
            }),
        }
    }

    /// Replaces the watch list. Returns the addresses that were refused.
    pub fn set_watch(&self, items: Vec<WatchItem>) -> Vec<String> {
        let mut rejected = Vec::new();
        let mut want: HashMap<SocketAddr, Duration> = HashMap::new();
        for it in items {
            let Some(addr) = crate::addr::parse_addr(&it.addr) else {
                rejected.push(it.addr);
                continue;
            };
            let iv = Duration::from_secs_f64(it.interval.clamp(0.0, 600.0)).max(self.inner.cfg.min_interval);
            let e = want.entry(addr).or_insert(iv);
            *e = (*e).min(iv);
        }

        let now = Instant::now();
        let mut targets = self.inner.targets.lock().unwrap();
        targets.retain(|a, _| want.contains_key(a));
        for (addr, iv) in want {
            match targets.get_mut(&addr) {
                Some(t) => {
                    // e.g. a server was just selected: refresh it right away.
                    if iv < t.interval && t.next > now + iv {
                        t.next = now;
                    }
                    t.interval = iv;
                }
                None => {
                    // Spread first queries so a big list doesn't burst at once.
                    let spread = iv.min(Duration::from_secs(1)).as_millis() as u64;
                    targets.insert(addr, Target {
                        interval: iv,
                        next: now + Duration::from_millis(fastrand::u64(0..=spread)),
                        busy: false,
                        fails: 0,
                        engine: Engine::Unknown,
                        last: None,
                    });
                }
            }
        }
        rejected
    }

    /// A2S_RULES on demand, using the engine learnt from polling.
    pub async fn rules(&self, addr: SocketAddr) -> Result<Vec<a2s::Rule>, a2s::Error> {
        let eng = self.inner.targets.lock().unwrap().get(&addr).map(|t| t.engine).unwrap_or(Engine::Unknown);
        let _permit = self.inner.sem.acquire().await.expect("semaphore open");
        self.inner.client.rules(addr, eng).await
    }

    /// Schedules polls and flushes results to sink every 200 ms. Runs forever.
    pub async fn run(self, sink: Sink) {
        let flusher = self.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_millis(200));
            loop {
                tick.tick().await;
                let batch: Vec<_> = flusher.inner.pending.lock().unwrap().drain().map(|(_, r)| r).collect();
                if !batch.is_empty() {
                    sink(batch);
                }
            }
        });

        let mut tick = tokio::time::interval(Duration::from_millis(100));
        loop {
            tick.tick().await;
            let now = Instant::now();
            let due: Vec<SocketAddr> = {
                let mut targets = self.inner.targets.lock().unwrap();
                targets
                    .iter_mut()
                    .filter(|(_, t)| !t.busy && t.next <= now)
                    .map(|(a, t)| {
                        t.busy = true;
                        *a
                    })
                    .collect()
            };
            for addr in due {
                tokio::spawn(self.clone().poll(addr));
            }
        }
    }

    async fn poll(self, addr: SocketAddr) {
        let (info, players) = {
            let _permit = self.inner.sem.acquire().await.expect("semaphore open");
            let info = self.inner.client.info(addr).await;
            let players = match &info {
                Ok((i, _)) if i.players > 0 => Some(self.inner.client.players(addr, i.engine_kind()).await),
                _ => None,
            };
            (info, players)
        };
        let geo = self.inner.geo.as_ref().and_then(|g| g.get(addr.ip()));
        let now = Instant::now();
        let ts = now_ms();

        let mut targets = self.inner.targets.lock().unwrap();
        let Some(t) = targets.get_mut(&addr) else { return }; // unwatched meanwhile
        t.busy = false;
        let jitter = Duration::from_millis(fastrand::u64(0..=t.interval.as_millis() as u64 / 10));
        t.next = now + t.interval + jitter;

        let res = match info {
            Err(e) => {
                t.fails += 1;
                let was_online = t.last.as_ref().is_some_and(|l| l.online);
                if was_online && t.fails < self.inner.cfg.fail_threshold {
                    return; // one lost packet isn't an outage
                }
                ServerResult {
                    addr: addr.to_string(),
                    online: false,
                    ping: 0,
                    info: t.last.as_ref().and_then(|l| l.info.clone()),
                    players: vec![],
                    geo,
                    error: Some(e.to_string()),
                    ts,
                    last_seen: t.last.as_ref().and_then(|l| l.last_seen),
                }
            }
            Ok((info, rtt)) => {
                t.fails = 0;
                t.engine = info.engine_kind();
                let players = match players {
                    Some(Ok(p)) => p,
                    // Keep the previous list rather than flicker to empty.
                    Some(Err(_)) => t.last.as_ref().map(|l| l.players.clone()).unwrap_or_default(),
                    None => vec![],
                };
                ServerResult {
                    addr: addr.to_string(),
                    online: true,
                    ping: rtt.as_millis() as u32,
                    info: Some(info),
                    players,
                    geo,
                    error: None,
                    ts,
                    last_seen: Some(ts),
                }
            }
        };
        let res = Arc::new(res);
        t.last = Some(res.clone());
        drop(targets);
        self.inner.pending.lock().unwrap().insert(addr, res);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::UdpSocket;

    async fn fake_server(answer: Arc<std::sync::atomic::AtomicBool>) -> SocketAddr {
        let sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let addr = sock.local_addr().unwrap();
        tokio::spawn(async move {
            let mut buf = [0u8; 1500];
            while let Ok((_, from)) = sock.recv_from(&mut buf).await {
                if !answer.load(std::sync::atomic::Ordering::SeqCst) {
                    continue;
                }
                let mut p = vec![0xFF, 0xFF, 0xFF, 0xFF, b'I', 48];
                for s in ["Fake", "de_dust2", "cstrike", "Counter-Strike"] {
                    p.extend_from_slice(s.as_bytes());
                    p.push(0);
                }
                p.extend_from_slice(&10u16.to_le_bytes());
                p.extend_from_slice(&[0, 32, 0, b'd', b'l', 0, 1]);
                p.extend_from_slice(b"1.1.2.7\0");
                let _ = sock.send_to(&p, from).await;
            }
        });
        addr
    }

    #[tokio::test]
    async fn polls_reports_offline_and_unwatches() {
        let answer = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let addr = fake_server(answer.clone()).await;
        let p = Poller::new(
            a2s::Client::new(Duration::from_millis(150), 0),
            None,
            Config { min_interval: Duration::from_millis(100), max_inflight: 4, fail_threshold: 2 },
        );
        let got: Arc<Mutex<Vec<Arc<ServerResult>>>> = Default::default();
        let sink_got = got.clone();
        tokio::spawn(p.clone().run(Arc::new(move |b| sink_got.lock().unwrap().extend(b))));

        let rejected = p.set_watch(vec![
            WatchItem { addr: addr.to_string(), interval: 0.2 },
            WatchItem { addr: "0.0.0.0:1".into(), interval: 1.0 },
        ]);
        assert_eq!(rejected, vec!["0.0.0.0:1".to_string()]);

        let wait_for = |f: fn(&ServerResult) -> bool| {
            let got = got.clone();
            async move {
                for _ in 0..60 {
                    if got.lock().unwrap().iter().any(|r| f(r)) {
                        return;
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                panic!("timed out");
            }
        };
        wait_for(|r| r.online && r.info.as_ref().unwrap().name == "Fake").await;

        answer.store(false, std::sync::atomic::Ordering::SeqCst);
        wait_for(|r| !r.online && r.info.is_some() && r.last_seen.is_some()).await;

        p.set_watch(vec![]);
        assert!(p.inner.targets.lock().unwrap().is_empty());
    }
}

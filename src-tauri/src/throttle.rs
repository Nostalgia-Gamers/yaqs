//! Per-IP query rate limit. Some hosting providers drop UDP queries beyond a
//! few per second to the same IP, which made servers that share a machine
//! show as down when they were all refreshed at once. Every query start (a
//! poll, a rules request, a discovery probe) takes a token for its server's
//! IP. Queries to one IP are evenly spaced, one every 1/rate seconds, never
//! in a burst: a rate limiter on the provider's side counts any one second.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct HostLimiter {
    inner: Mutex<State>,
}

struct State {
    /// Queries per second per IP; 0 means no limit.
    rate: f64,
    buckets: HashMap<IpAddr, Bucket>,
}

struct Bucket {
    tokens: f64,
    at: Instant,
}

impl HostLimiter {
    pub fn new(rate: f64) -> Self {
        HostLimiter { inner: Mutex::new(State { rate: rate.max(0.0), buckets: HashMap::new() }) }
    }

    pub fn set_rate(&self, rate: f64) {
        let mut s = self.inner.lock().unwrap();
        s.rate = rate.max(0.0);
        s.buckets.clear();
    }

    /// Takes a token for `ip` if one is available now. The bucket holds a single
    /// token, so queries to one IP go out evenly spaced instead of in bursts.
    pub fn try_take(&self, ip: IpAddr, now: Instant) -> bool {
        let mut s = self.inner.lock().unwrap();
        let rate = s.rate;
        if rate <= 0.0 {
            return true;
        }
        let cap = 1.0;
        let b = s.buckets.entry(ip).or_insert(Bucket { tokens: cap, at: now });
        b.tokens = (b.tokens + now.saturating_duration_since(b.at).as_secs_f64() * rate).min(cap);
        b.at = now;
        if b.tokens >= 1.0 {
            b.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    /// Waits until a token for `ip` is available, then takes it.
    pub async fn take(&self, ip: IpAddr) {
        while !self.try_take(ip, Instant::now()) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bursts_then_refills() {
        let l = HostLimiter::new(5.0);
        let a: IpAddr = "200.1.2.3".parse().unwrap();
        let b: IpAddr = "200.1.2.4".parse().unwrap();
        let t0 = Instant::now();
        assert_eq!((0..8).filter(|_| l.try_take(a, t0)).count(), 1, "no bursts: one at a time");
        assert!(l.try_take(b, t0), "another IP has its own budget");
        assert!(!l.try_take(a, t0 + Duration::from_millis(100)));
        assert!(l.try_take(a, t0 + Duration::from_millis(200)), "5/s means one every 200 ms");
        assert_eq!((0..8).filter(|_| l.try_take(a, t0 + Duration::from_secs(10))).count(), 1, "idle time doesn't bank a burst");
        // Any one-second window sees at most rate + 1 queries.
        let taken = (0..100).filter(|i| l.try_take(a, t0 + Duration::from_secs(20) + Duration::from_millis(i * 10))).count();
        assert!(taken <= 6, "{taken} queries in one second at 5/s");
    }

    #[test]
    fn zero_means_unlimited() {
        let l = HostLimiter::new(0.0);
        let a: IpAddr = "200.1.2.3".parse().unwrap();
        assert!((0..1000).all(|_| l.try_take(a, Instant::now())));
        l.set_rate(2.0);
        assert_eq!((0..5).filter(|_| l.try_take(a, Instant::now())).count(), 1);
    }
}

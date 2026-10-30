//! Parsing what users type into the add box, and resolving hostnames.
//! As a desktop app, LAN servers are allowed; only addresses that can't be a
//! game server (unspecified, multicast, broadcast) are refused.

use std::net::{IpAddr, SocketAddr};

pub const MAX_PORTS: usize = 128;

/// Ports tried when the user gives an address without a port.
pub fn scan_ports() -> Vec<u16> {
    (27000..=27060).chain([28015, 28016, 28017]).collect()
}

#[derive(Debug, PartialEq)]
pub struct Target {
    pub host: String,
    pub ports: Vec<u16>,
    /// No port given: scan_ports(), and only answering servers count.
    pub scan: bool,
}

pub fn allowed(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => !v4.is_unspecified() && !v4.is_multicast() && !v4.is_broadcast(),
        IpAddr::V6(v6) => !v6.is_unspecified() && !v6.is_multicast(),
    }
}

/// Whether an IP is on the public internet (worth a location lookup).
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            !(v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified()
                || (a == 100 && (64..128).contains(&b)))
        }
        IpAddr::V6(v6) => !(v6.is_loopback() || v6.is_unspecified() || (v6.segments()[0] & 0xfe00) == 0xfc00
            || (v6.segments()[0] & 0xffc0) == 0xfe80),
    }
}

fn clean(s: &str) -> &str {
    let s = s.trim();
    let s = s.strip_prefix("connect ").unwrap_or(s);
    let s = s.strip_prefix("steam://connect/").unwrap_or(s);
    s.trim_end_matches('/').trim()
}

/// Parses a literal "ip:port" into the canonical address used as a key.
pub fn parse_addr(s: &str) -> Option<SocketAddr> {
    let a: SocketAddr = clean(s).parse().ok()?;
    let a = SocketAddr::new(a.ip().to_canonical(), a.port());
    (a.port() != 0 && allowed(a.ip())).then_some(a)
}

/// Accepts "host", "host:27015", "host:27015-27030" and "host:27015,27017"
/// (IPv6 as "[ip]:ports"), with optional "connect " or "steam://connect/".
pub fn parse_target(s: &str) -> Result<Target, &'static str> {
    const BAD: &str = "invalid address";
    let s = clean(s);
    if s.is_empty() {
        return Err(BAD);
    }
    if let Ok(ip) = s.trim_matches(|c| c == '[' || c == ']').parse::<IpAddr>() {
        return Ok(Target { host: ip.to_string(), ports: scan_ports(), scan: true });
    }
    let (host, spec) = if let Some(rest) = s.strip_prefix('[') {
        let (h, spec) = rest.split_once("]:").ok_or(BAD)?;
        (h, spec)
    } else if let Some((h, spec)) = s.rsplit_once(':') {
        if h.contains(':') {
            return Err(BAD);
        }
        (h, spec)
    } else {
        return Ok(Target { host: s.to_string(), ports: scan_ports(), scan: true });
    };
    if host.is_empty() {
        return Err(BAD);
    }

    let mut ports: Vec<u16> = Vec::new();
    let mut push = |p: u32| -> Result<(), &'static str> {
        if p == 0 || p > 65535 {
            return Err(BAD);
        }
        if !ports.contains(&(p as u16)) {
            ports.push(p as u16);
        }
        if ports.len() > MAX_PORTS {
            return Err(BAD);
        }
        Ok(())
    };
    for part in spec.split(',') {
        let part = part.trim();
        match part.split_once('-') {
            None => push(part.parse().map_err(|_| BAD)?)?,
            Some((lo, hi)) => {
                let lo: u32 = lo.trim().parse().map_err(|_| BAD)?;
                let hi: u32 = hi.trim().parse().map_err(|_| BAD)?;
                if hi < lo || (hi - lo) as usize >= MAX_PORTS {
                    return Err(BAD);
                }
                for p in lo..=hi {
                    push(p)?;
                }
            }
        }
    }
    if ports.is_empty() {
        return Err(BAD);
    }
    Ok(Target { host: host.to_string(), ports, scan: false })
}

/// Resolves an IP literal or hostname, preferring IPv4 (game servers rarely
/// listen on IPv6).
pub async fn resolve_host(host: &str) -> Result<IpAddr, &'static str> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if allowed(ip) { Ok(ip.to_canonical()) } else { Err("address not allowed") };
    }
    if host.len() > 253 || host.contains([' ', '/', '\\', '@']) {
        return Err("invalid address");
    }
    let addrs: Vec<IpAddr> = tokio::net::lookup_host((host, 0))
        .await
        .map_err(|_| "host not found")?
        .map(|a| a.ip().to_canonical())
        .filter(|ip| allowed(*ip))
        .collect();
    addrs.iter().find(|ip| ip.is_ipv4()).or(addrs.first()).copied().ok_or("host not found")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets() {
        let scan = |h: &str| Target { host: h.into(), ports: scan_ports(), scan: true };
        let ports = |h: &str, p: &[u16]| Target { host: h.into(), ports: p.to_vec(), scan: false };
        assert_eq!(parse_target("200.1.2.3"), Ok(scan("200.1.2.3")));
        assert_eq!(parse_target("cs.example.com"), Ok(scan("cs.example.com")));
        assert_eq!(parse_target("200.1.2.3:27016"), Ok(ports("200.1.2.3", &[27016])));
        assert_eq!(parse_target("connect 200.1.2.3:27015-27017"), Ok(ports("200.1.2.3", &[27015, 27016, 27017])));
        assert_eq!(parse_target("200.1.2.3:27015, 27020,27015"), Ok(ports("200.1.2.3", &[27015, 27020])));
        assert_eq!(parse_target("[2001:db8::1]:27015"), Ok(ports("2001:db8::1", &[27015])));
        assert_eq!(parse_target("2001:4860::1"), Ok(scan("2001:4860::1")));
        for bad in ["200.1.2.3:27020-27010", "200.1.2.3:1-60000", "200.1.2.3:0", "200.1.2.3:abc", ":27015", ""] {
            assert!(parse_target(bad).is_err(), "{bad} should fail");
        }
    }

    #[test]
    fn addrs() {
        assert_eq!(parse_addr("8.8.8.8:27015").unwrap().to_string(), "8.8.8.8:27015");
        assert_eq!(parse_addr("192.168.1.5:27015").unwrap().to_string(), "192.168.1.5:27015"); // LAN is fine
        assert!(parse_addr("0.0.0.0:27015").is_none());
        assert!(parse_addr("224.0.0.1:27015").is_none());
        assert!(parse_addr("8.8.8.8:0").is_none());
        assert!(is_public("190.1.2.3".parse().unwrap()));
        assert!(!is_public("192.168.0.1".parse().unwrap()));
        assert!(!is_public("100.64.0.1".parse().unwrap()));
    }
}

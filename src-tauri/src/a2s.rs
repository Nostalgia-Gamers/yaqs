//! Valve A2S server queries (INFO, PLAYER, RULES) for GoldSrc and Source.

use serde::Serialize;
use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::io::Read;
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;

/// Which split-packet layout a server uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Engine {
    Unknown,
    GoldSrc,
    Source,
}

/// A2S_INFO, normalised across the Source 'I' and obsolete GoldSrc 'm' replies.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub protocol: u8,
    pub name: String,
    pub map: String,
    pub folder: String,
    pub game: String,
    #[serde(rename = "appid")]
    pub app_id: u32,
    pub players: u8,
    pub max_players: u8,
    pub bots: u8,
    pub server_type: String,
    pub environment: String,
    pub password: bool,
    pub vac: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keywords: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tv_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tv_name: Option<String>,
    pub engine: &'static str,
}

impl Info {
    pub fn engine_kind(&self) -> Engine {
        if self.engine == "goldsrc" {
            Engine::GoldSrc
        } else {
            Engine::Source
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Player {
    pub name: String,
    pub score: i32,
    pub duration: f32,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Rule {
    pub name: String,
    pub value: String,
}

#[derive(Debug)]
pub enum Error {
    Timeout,
    Malformed,
    TooLarge,
    Io(std::io::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Timeout => write!(f, "timeout"),
            Error::Malformed => write!(f, "malformed response"),
            Error::TooLarge => write!(f, "response too large"),
            Error::Io(e) => write!(f, "{e}"),
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

type Res<T> = std::result::Result<T, Error>;

const SINGLE: i32 = -1;
const SPLIT: i32 = -2;
const MAX_SPLIT_PACKETS: usize = 32;
const MAX_RESPONSE: usize = 1 << 20;
const MAX_STRAY: usize = 4;
const NO_CHALLENGE: [u8; 4] = [0xFF; 4];

/// Sends A2S queries. Each query gets its own connected socket, so a late
/// reply to one query can never be read as the answer to another.
#[derive(Clone)]
pub struct Client {
    pub timeout: Duration,
    pub retries: u32,
}

impl Client {
    pub fn new(timeout: Duration, retries: u32) -> Self {
        Client { timeout, retries }
    }

    /// A2S_INFO. The returned duration is the round trip of the last request
    /// (after any challenge), used as the ping.
    pub async fn info(&self, addr: SocketAddr) -> Res<(Info, Duration)> {
        self.retry(|| async move {
            let mut s = Session::open(addr, self.timeout, Engine::Unknown).await?;
            let mut req = header(b'T');
            req.extend_from_slice(b"Source Engine Query\0");
            let (resp, rtt) = s.challenged(&req, None, &[b'I', b'm']).await?;
            Ok((parse_info(&resp)?, rtt))
        })
        .await
    }

    pub async fn players(&self, addr: SocketAddr, eng: Engine) -> Res<Vec<Player>> {
        self.retry(|| async move {
            let mut s = Session::open(addr, self.timeout, eng).await?;
            let (resp, _) = s.challenged(&header(b'U'), Some(NO_CHALLENGE), &[b'D']).await?;
            parse_players(&resp)
        })
        .await
    }

    /// A2S_RULES. Some games (CS2) never answer, which shows up as a timeout.
    pub async fn rules(&self, addr: SocketAddr, eng: Engine) -> Res<Vec<Rule>> {
        self.retry(|| async move {
            let mut s = Session::open(addr, self.timeout, eng).await?;
            let (resp, _) = s.challenged(&header(b'V'), Some(NO_CHALLENGE), &[b'E']).await?;
            parse_rules(&resp)
        })
        .await
    }

    async fn retry<'a, T, F, Fut>(&'a self, f: F) -> Res<T>
    where
        F: Fn() -> Fut,
        Fut: Future<Output = Res<T>> + 'a,
    {
        let mut attempt = 0;
        loop {
            match f().await {
                Err(Error::Timeout) if attempt < self.retries => attempt += 1,
                other => return other,
            }
        }
    }
}

fn header(kind: u8) -> Vec<u8> {
    vec![0xFF, 0xFF, 0xFF, 0xFF, kind]
}

struct Session {
    sock: UdpSocket,
    deadline: tokio::time::Instant,
    hint: Engine,
    buf: Vec<u8>,
}

impl Session {
    async fn open(addr: SocketAddr, timeout: Duration, hint: Engine) -> Res<Session> {
        let bind: SocketAddr = if addr.is_ipv4() { "0.0.0.0:0".parse().unwrap() } else { "[::]:0".parse().unwrap() };
        let sock = UdpSocket::bind(bind).await?;
        sock.connect(addr).await?;
        Ok(Session { sock, deadline: tokio::time::Instant::now() + timeout, hint, buf: vec![0; 65535] })
    }

    async fn send(&self, req: &[u8], challenge: Option<[u8; 4]>) -> Res<Instant> {
        let mut out = req.to_vec();
        if let Some(c) = challenge {
            out.extend_from_slice(&c);
        }
        self.sock.send(&out).await?;
        Ok(Instant::now())
    }

    /// Sends req (+challenge) and follows S2C_CHALLENGE replies until one of
    /// the expected response types arrives.
    async fn challenged(&mut self, req: &[u8], challenge: Option<[u8; 4]>, expect: &[u8]) -> Res<(Vec<u8>, Duration)> {
        let mut sent = self.send(req, challenge).await?;
        let (mut challenges, mut stray) = (0, 0);
        loop {
            let resp = self.recv().await?;
            let Some(&kind) = resp.first() else { continue };
            if expect.contains(&kind) {
                return Ok((resp, sent.elapsed()));
            }
            if kind == b'A' && resp.len() >= 5 && challenges < 2 {
                challenges += 1;
                sent = self.send(req, Some([resp[1], resp[2], resp[3], resp[4]])).await?;
                continue;
            }
            stray += 1;
            if stray > MAX_STRAY {
                return Err(Error::Malformed);
            }
        }
    }

    /// Reads one complete response, reassembling split packets.
    async fn recv(&mut self) -> Res<Vec<u8>> {
        let mut split: Option<SplitBuf> = None;
        loop {
            let n = match tokio::time::timeout_at(self.deadline, self.sock.recv(&mut self.buf)).await {
                Err(_) => return Err(Error::Timeout),
                Ok(r) => r?,
            };
            if n < 5 {
                continue;
            }
            let head = i32::from_le_bytes([self.buf[0], self.buf[1], self.buf[2], self.buf[3]]);
            match head {
                SINGLE => return Ok(self.buf[4..n].to_vec()),
                SPLIT => {
                    let sb = split.get_or_insert_with(|| SplitBuf::new(self.hint));
                    if let Some(out) = sb.add(&self.buf[4..n])? {
                        return Ok(out);
                    }
                }
                _ => {}
            }
        }
    }
}

/// Reassembles a 0xFFFFFFFE multi-packet response. The layout is detected
/// from the first packet (which carries the inner 0xFFFFFFFF header), falling
/// back to the engine hint.
struct SplitBuf {
    hint: Engine,
    id: Option<i32>,
    raw: Vec<Vec<u8>>,
}

fn is_single(b: &[u8]) -> bool {
    b.len() >= 4 && b[..4] == [0xFF; 4]
}

impl SplitBuf {
    fn new(hint: Engine) -> Self {
        SplitBuf { hint, id: None, raw: Vec::new() }
    }

    fn compressed(&self) -> bool {
        self.id.map(|id| (id as u32) & 0x8000_0000 != 0).unwrap_or(false)
    }

    fn add(&mut self, p: &[u8]) -> Res<Option<Vec<u8>>> {
        if p.len() < 5 {
            return Ok(None);
        }
        let id = i32::from_le_bytes([p[0], p[1], p[2], p[3]]);
        match self.id {
            None => self.id = Some(id),
            Some(cur) if cur != id => return Ok(None), // stale packet
            _ => {}
        }
        self.raw.push(p.to_vec());
        if self.raw.len() > MAX_SPLIT_PACKETS {
            return Err(Error::TooLarge);
        }
        match self.detect() {
            Engine::Unknown => Ok(None),
            eng => self.assemble(eng),
        }
    }

    fn detect(&self) -> Engine {
        for p in &self.raw {
            if p.len() >= 9 && p[4] >> 4 == 0 && is_single(&p[5..9]) {
                return Engine::GoldSrc;
            }
            if p.len() >= 12 && p[5] == 0 && is_single(&p[8..12]) {
                return Engine::Source;
            }
            if p.len() >= 19 && p[5] == 0 && self.compressed() && &p[16..19] == b"BZh" {
                return Engine::Source;
            }
        }
        self.hint
    }

    fn assemble(&self, eng: Engine) -> Res<Option<Vec<u8>>> {
        let mut total: Option<usize> = None;
        let mut parts: HashMap<usize, &[u8]> = HashMap::new();
        for p in &self.raw {
            let (num, tot, data) = if eng == Engine::GoldSrc {
                ((p[4] >> 4) as usize, (p[4] & 0x0F) as usize, &p[5..])
            } else {
                if p.len() < 8 {
                    return Err(Error::Malformed);
                }
                (p[5] as usize, p[4] as usize, &p[8..])
            };
            if tot == 0 || num >= tot || total.is_some_and(|t| t != tot) {
                return Err(Error::Malformed);
            }
            total = Some(tot);
            parts.insert(num, data);
        }
        let total = total.unwrap_or(0);
        if parts.len() < total {
            return Ok(None);
        }
        let mut out = Vec::new();
        for k in 0..total {
            out.extend_from_slice(parts[&k]);
            if out.len() > MAX_RESPONSE {
                return Err(Error::TooLarge);
            }
        }
        if eng == Engine::Source && self.compressed() {
            out = decompress(&out)?;
        }
        if !is_single(&out) {
            return Err(Error::Malformed);
        }
        Ok(Some(out[4..].to_vec()))
    }
}

fn decompress(b: &[u8]) -> Res<Vec<u8>> {
    if b.len() < 8 {
        return Err(Error::Malformed);
    }
    let size = u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize;
    let sum = u32::from_le_bytes([b[4], b[5], b[6], b[7]]);
    if size > MAX_RESPONSE {
        return Err(Error::TooLarge);
    }
    let mut out = Vec::with_capacity(size);
    bzip2_rs::DecoderReader::new(&b[8..])
        .take(size as u64 + 1)
        .read_to_end(&mut out)
        .map_err(|_| Error::Malformed)?;
    if out.len() != size || crc32fast::hash(&out) != sum {
        return Err(Error::Malformed);
    }
    Ok(out)
}

/// Little-endian cursor with a sticky "bad" flag, so a parser can read a
/// whole struct and check for truncation once.
struct Reader<'a> {
    b: &'a [u8],
    off: usize,
    bad: bool,
}

impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Self {
        Reader { b, off: 0, bad: false }
    }
    fn remaining(&self) -> usize {
        self.b.len().saturating_sub(self.off)
    }
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        if self.bad || self.remaining() < n {
            self.bad = true;
            return None;
        }
        let s = &self.b[self.off..self.off + n];
        self.off += n;
        Some(s)
    }
    fn u8(&mut self) -> u8 {
        self.take(1).map(|s| s[0]).unwrap_or(0)
    }
    fn u16(&mut self) -> u16 {
        self.take(2).map(|s| u16::from_le_bytes([s[0], s[1]])).unwrap_or(0)
    }
    fn i32(&mut self) -> i32 {
        self.take(4).map(|s| i32::from_le_bytes([s[0], s[1], s[2], s[3]])).unwrap_or(0)
    }
    fn u64(&mut self) -> u64 {
        self.take(8).map(|s| u64::from_le_bytes(s.try_into().unwrap())).unwrap_or(0)
    }
    fn f32(&mut self) -> f32 {
        f32::from_bits(self.i32() as u32)
    }
    /// NUL-terminated string. GoldSrc names are often Latin-1/CP1252, so
    /// invalid UTF-8 is decoded byte-by-byte.
    fn string(&mut self) -> String {
        if self.bad {
            return String::new();
        }
        match self.b[self.off..].iter().position(|&c| c == 0) {
            Some(end) => {
                let raw = &self.b[self.off..self.off + end];
                self.off += end + 1;
                match std::str::from_utf8(raw) {
                    Ok(s) => s.to_string(),
                    Err(_) => raw.iter().map(|&c| c as char).collect(),
                }
            }
            None => {
                self.bad = true;
                String::new()
            }
        }
    }
}

fn server_type(c: u8) -> String {
    match c {
        b'd' | b'D' => "dedicated",
        b'l' | b'L' => "listen",
        b'p' | b'P' => "proxy",
        _ => "",
    }
    .into()
}

fn environment(c: u8) -> String {
    match c {
        b'l' | b'L' => "linux",
        b'w' | b'W' => "windows",
        b'm' | b'o' => "mac",
        _ => "",
    }
    .into()
}

pub(crate) fn parse_info(p: &[u8]) -> Res<Info> {
    let Some((&kind, rest)) = p.split_first() else { return Err(Error::Malformed) };
    let mut r = Reader::new(rest);
    let mut i = Info::default();
    match kind {
        b'I' => {
            i.protocol = r.u8();
            i.name = r.string();
            i.map = r.string();
            i.folder = r.string();
            i.game = r.string();
            i.app_id = r.u16() as u32;
            i.players = r.u8();
            i.max_players = r.u8();
            i.bots = r.u8();
            i.server_type = server_type(r.u8());
            i.environment = environment(r.u8());
            i.password = r.u8() == 1;
            i.vac = r.u8() == 1;
            if i.app_id == 2400 {
                r.take(3); // The Ship: mode, witnesses, duration
            }
            if r.bad {
                return Err(Error::Malformed);
            }
            i.version = Some(r.string());
            if !r.bad && r.remaining() > 0 {
                let edf = r.u8();
                if edf & 0x80 != 0 {
                    i.game_port = Some(r.u16());
                }
                if edf & 0x10 != 0 {
                    i.steam_id = Some(r.u64().to_string());
                }
                if edf & 0x40 != 0 {
                    i.tv_port = Some(r.u16());
                    i.tv_name = Some(r.string());
                }
                if edf & 0x20 != 0 {
                    i.keywords = Some(r.string());
                }
                if edf & 0x01 != 0 {
                    let gid = r.u64();
                    i.game_id = Some(gid.to_string());
                    if i.app_id == 0 {
                        i.app_id = (gid & 0xFF_FFFF) as u32;
                    }
                }
            }
            i.engine = if i.app_id > 0 && i.app_id < 200 { "goldsrc" } else { "source" };
        }
        b'm' => {
            r.string(); // address
            i.name = r.string();
            i.map = r.string();
            i.folder = r.string();
            i.game = r.string();
            i.players = r.u8();
            i.max_players = r.u8();
            i.protocol = r.u8();
            i.server_type = server_type(r.u8());
            i.environment = environment(r.u8());
            i.password = r.u8() == 1;
            if r.u8() == 1 {
                r.string(); // mod link
                r.string(); // download link
                r.take(1 + 4 + 4 + 1 + 1);
            }
            i.vac = r.u8() == 1;
            i.bots = r.u8();
            if r.bad {
                return Err(Error::Malformed);
            }
            i.engine = "goldsrc";
        }
        _ => return Err(Error::Malformed),
    }
    Ok(i)
}

pub(crate) fn parse_players(p: &[u8]) -> Res<Vec<Player>> {
    if p.first() != Some(&b'D') {
        return Err(Error::Malformed);
    }
    let mut r = Reader::new(&p[1..]);
    let n = r.u8() as usize;
    let mut out = Vec::with_capacity(n);
    for _ in 0..n {
        r.u8(); // index
        let name = r.string();
        let score = r.i32();
        let duration = r.f32();
        if r.bad {
            break; // big servers truncate the list; keep what parsed
        }
        out.push(Player { name, score, duration });
    }
    if r.bad && out.is_empty() && n > 0 {
        return Err(Error::Malformed);
    }
    Ok(out)
}

pub(crate) fn parse_rules(p: &[u8]) -> Res<Vec<Rule>> {
    if p.first() != Some(&b'E') {
        return Err(Error::Malformed);
    }
    let mut r = Reader::new(&p[1..]);
    let n = r.u16() as usize;
    let mut out = Vec::with_capacity(n);
    for _ in 0..n {
        let name = r.string();
        let value = r.string();
        if r.bad {
            break;
        }
        out.push(Rule { name, value });
    }
    if r.bad && out.is_empty() && n > 0 {
        return Err(Error::Malformed);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    const CHALLENGE: [u8; 4] = [0x11, 0x22, 0x33, 0x44];

    #[derive(Default)]
    struct Pkt(Vec<u8>);
    impl Pkt {
        fn single() -> Self {
            Pkt(vec![0xFF; 4])
        }
        fn raw(mut self, b: &[u8]) -> Self {
            self.0.extend_from_slice(b);
            self
        }
        fn u8(self, v: u8) -> Self {
            self.raw(&[v])
        }
        fn u16(self, v: u16) -> Self {
            self.raw(&v.to_le_bytes())
        }
        fn i32(self, v: i32) -> Self {
            self.raw(&v.to_le_bytes())
        }
        fn u64(self, v: u64) -> Self {
            self.raw(&v.to_le_bytes())
        }
        fn f32(self, v: f32) -> Self {
            self.raw(&v.to_le_bytes())
        }
        fn s(self, v: &str) -> Self {
            self.raw(v.as_bytes()).u8(0)
        }
    }

    /// Starts a UDP server that answers each datagram with handle(req).
    async fn fake<F>(handle: F) -> SocketAddr
    where
        F: Fn(&[u8]) -> Vec<Vec<u8>> + Send + Sync + 'static,
    {
        let sock = Arc::new(UdpSocket::bind("127.0.0.1:0").await.unwrap());
        let addr = sock.local_addr().unwrap();
        tokio::spawn(async move {
            let mut buf = vec![0u8; 2048];
            while let Ok((n, from)) = sock.recv_from(&mut buf).await {
                for out in handle(&buf[..n]) {
                    let _ = sock.send_to(&out, from).await;
                }
            }
        });
        addr
    }

    fn gate(req: &[u8], ok: impl FnOnce() -> Vec<Vec<u8>>) -> Vec<Vec<u8>> {
        if req.ends_with(&CHALLENGE) {
            ok()
        } else {
            vec![Pkt::single().u8(b'A').raw(&CHALLENGE).0]
        }
    }

    fn client() -> Client {
        Client::new(Duration::from_millis(500), 0)
    }

    fn rules_payload() -> Vec<u8> {
        Pkt::single().u8(b'E').u16(2).s("mp_timelimit").s("30").s("sv_gravity").s("800").0
    }

    fn check_rules(rules: &[Rule]) {
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0], Rule { name: "mp_timelimit".into(), value: "30".into() });
        assert_eq!(rules[1], Rule { name: "sv_gravity".into(), value: "800".into() });
    }

    #[tokio::test]
    async fn info_source_with_challenge() {
        let addr = fake(|req| {
            if req[4] != b'T' {
                return vec![];
            }
            gate(req, || {
                vec![Pkt::single().u8(b'I').u8(17).s("Test Server").s("de_dust2").s("csgo").s("Counter-Strike 2")
                    .u16(730).u8(5).u8(20).u8(1).u8(b'd').u8(b'l').u8(0).u8(1).s("1.40.1.1")
                    .u8(0x80 | 0x10 | 0x20 | 0x01).u16(27015).u64(90000000000000001).s("secure,cs2").u64(730).0]
            })
        })
        .await;
        let (info, _) = client().info(addr).await.unwrap();
        assert_eq!(info.name, "Test Server");
        assert_eq!(info.app_id, 730);
        assert_eq!((info.players, info.max_players, info.bots), (5, 20, 1));
        assert!(info.vac && !info.password);
        assert_eq!(info.game_port, Some(27015));
        assert_eq!(info.steam_id.as_deref(), Some("90000000000000001"));
        assert_eq!(info.keywords.as_deref(), Some("secure,cs2"));
        assert_eq!(info.engine, "source");
    }

    #[tokio::test]
    async fn info_goldsrc_obsolete() {
        let addr = fake(|_| {
            vec![Pkt::single().u8(b'm').s("1.2.3.4:27015").s("Old HLDS").s("de_nuke").s("cstrike").s("Counter-Strike")
                .u8(3).u8(16).u8(47).u8(b'D').u8(b'W').u8(0)
                .u8(1).s("http://mod").s("http://dl").u8(0).i32(1).i32(1000).u8(0).u8(1)
                .u8(1).u8(2).0]
        })
        .await;
        let (info, _) = client().info(addr).await.unwrap();
        assert_eq!(info.engine, "goldsrc");
        assert_eq!((info.players, info.bots), (3, 2));
        assert!(info.vac);
        assert_eq!(info.environment, "windows");
    }

    #[tokio::test]
    async fn players_latin1() {
        let addr = fake(|req| {
            gate(req, || {
                vec![Pkt::single().u8(b'D').u8(2).u8(0).s("Shiobi").i32(15).f32(120.5)
                    .u8(0).raw(&[b'J', b'o', b's', 0xE9]).u8(0).i32(-2).f32(3.0).0]
            })
        })
        .await;
        let players = client().players(addr, Engine::GoldSrc).await.unwrap();
        assert_eq!(players.len(), 2);
        assert_eq!(players[0], Player { name: "Shiobi".into(), score: 15, duration: 120.5 });
        assert_eq!(players[1].name, "José");
    }

    #[tokio::test]
    async fn rules_goldsrc_split_out_of_order() {
        let addr = fake(|req| {
            gate(req, || {
                let body = rules_payload();
                let chunks = [&body[..10], &body[10..25], &body[25..]];
                [2usize, 0, 1]
                    .iter()
                    .map(|&i| Pkt(vec![]).i32(-2).i32(77).u8((i as u8) << 4 | 3).raw(chunks[i]).0)
                    .collect()
            })
        })
        .await;
        check_rules(&client().rules(addr, Engine::Unknown).await.unwrap());
    }

    #[tokio::test]
    async fn rules_source_split() {
        let addr = fake(|req| {
            gate(req, || {
                let body = rules_payload();
                let chunks = [&body[..20], &body[20..]];
                (0..2).map(|i| Pkt(vec![]).i32(-2).i32(5).u8(2).u8(i as u8).u16(1248).raw(chunks[i]).0).collect()
            })
        })
        .await;
        check_rules(&client().rules(addr, Engine::Source).await.unwrap());
    }

    // bzip2(rules_payload()), generated with Python's bz2 module.
    const BZ2_RULES: &str = "425a68393141592653596ab869400000134f80d000484002000000a2a65d200000a0002211a0d003ca14c269a034c4e8329a3d62eea7c06b41a9d096908b3c09b85a7c5dc914e14241aae1a500";

    #[tokio::test]
    async fn rules_source_compressed() {
        let addr = fake(|req| {
            gate(req, || {
                let comp: Vec<u8> = (0..BZ2_RULES.len()).step_by(2).map(|i| u8::from_str_radix(&BZ2_RULES[i..i + 2], 16).unwrap()).collect();
                let first = Pkt(vec![]).i32(rules_payload().len() as i32).i32(1091094103u32 as i32).raw(&comp[..30]).0;
                let chunks = [first, comp[30..].to_vec()];
                (0..2).map(|i| Pkt(vec![]).i32(-2).i32(-0x7FFF_FFF0).u8(2).u8(i as u8).u16(1248).raw(&chunks[i]).0).collect()
            })
        })
        .await;
        check_rules(&client().rules(addr, Engine::Unknown).await.unwrap());
    }

    #[tokio::test]
    async fn timeout_with_retry() {
        let addr = fake(|_| vec![]).await;
        let start = Instant::now();
        let err = Client::new(Duration::from_millis(100), 1).info(addr).await.unwrap_err();
        assert!(matches!(err, Error::Timeout));
        let took = start.elapsed();
        assert!(took >= Duration::from_millis(200) && took < Duration::from_secs(1), "{took:?}");
    }
}

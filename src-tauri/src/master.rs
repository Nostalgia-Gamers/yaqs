//! Server lists from Steam's Web API (IGameServersService/GetServerList),
//! which replaced the old UDP master servers. Needs a Steam Web API key.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const ENDPOINT: &str = "https://api.steampowered.com/IGameServersService/GetServerList/v1/";
const TTL: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Filter {
    pub appid: u32,
    pub name: Option<String>,
    pub map: Option<String>,
    pub gamedir: Option<String>,
    pub not_empty: bool,
    pub not_full: bool,
    pub no_password: bool,
    pub secure: bool,
    pub dedicated: bool,
    pub limit: Option<u32>,
}

fn clean(s: &str) -> String {
    s.chars().filter(|c| *c != '\\' && !c.is_control()).take(64).collect()
}

impl Filter {
    /// Valve's \key\value filter syntax.
    pub fn to_query(&self) -> String {
        let mut q = String::new();
        let mut add = |k: &str, v: &str| q.push_str(&format!("\\{k}\\{}", clean(v)));
        if self.appid > 0 {
            add("appid", &self.appid.to_string());
        }
        if let Some(d) = self.gamedir.as_deref().filter(|s| !s.is_empty()) {
            add("gamedir", d);
        }
        if let Some(n) = self.name.as_deref().filter(|s| !s.is_empty()) {
            let n = if n.contains('*') { n.to_string() } else { format!("*{n}*") };
            add("name_match", &n);
        }
        if let Some(m) = self.map.as_deref().filter(|s| !s.is_empty()) {
            add("map", m);
        }
        if self.not_empty {
            add("empty", "1");
        }
        if self.not_full {
            add("full", "1");
        }
        if self.no_password {
            add("password", "0");
        }
        if self.secure {
            add("secure", "1");
        }
        if self.dedicated {
            add("dedicated", "1");
        }
        q
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Server {
    pub addr: String,
    pub gameport: u16,
    pub steamid: String,
    pub name: String,
    pub appid: u32,
    pub gamedir: String,
    pub version: String,
    pub product: String,
    pub region: i32,
    pub players: u32,
    pub max_players: u32,
    pub bots: u32,
    pub map: String,
    pub secure: bool,
    pub dedicated: bool,
    pub os: String,
    pub gametype: String,
}

#[derive(Clone)]
pub struct Client {
    http: reqwest::Client,
    cache: Arc<Mutex<HashMap<String, (Instant, Vec<Server>)>>>,
}

impl Client {
    pub fn new() -> Self {
        Client {
            http: reqwest::Client::builder().timeout(Duration::from_secs(15)).build().expect("http client"),
            cache: Default::default(),
        }
    }

    pub async fn list(&self, key: &str, f: &Filter) -> Result<Vec<Server>, String> {
        if key.trim().is_empty() {
            return Err("Add your Steam Web API key in Settings to browse the master list.".into());
        }
        let limit = f.limit.filter(|l| (1..=2000).contains(l)).unwrap_or(500);
        let query = f.to_query();
        let cache_key = format!("{query}|{limit}");
        {
            let mut c = self.cache.lock().unwrap();
            c.retain(|_, (at, _)| at.elapsed() < TTL);
            if let Some((_, servers)) = c.get(&cache_key) {
                return Ok(servers.clone());
            }
        }

        let resp = self
            .http
            .get(ENDPOINT)
            .query(&[("key", key.trim()), ("filter", &query), ("limit", &limit.to_string())])
            .send()
            .await
            .map_err(|_| "Steam API unreachable".to_string())?;
        match resp.status().as_u16() {
            200 => {}
            401 | 403 => return Err("Steam rejected the API key. Check it in Settings.".into()),
            s => return Err(format!("Steam API error {s}")),
        }

        #[derive(Deserialize)]
        struct Body {
            response: Inner,
        }
        #[derive(Deserialize, Default)]
        struct Inner {
            #[serde(default)]
            servers: Vec<Server>,
        }
        let body: Body = resp.json().await.map_err(|e| format!("Steam API: {e}"))?;
        let servers = body.response.servers;
        self.cache.lock().unwrap().insert(cache_key, (Instant::now(), servers.clone()));
        Ok(servers)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_query() {
        let f = Filter {
            appid: 10,
            name: Some("Nostalgia".into()),
            map: Some("de_\\dust2".into()),
            not_empty: true,
            no_password: true,
            ..Default::default()
        };
        assert_eq!(f.to_query(), r"\appid\10\name_match\*Nostalgia*\map\de_dust2\empty\1\password\0");
        let g = Filter { name: Some("NG*".into()), ..Default::default() };
        assert_eq!(g.to_query(), r"\name_match\NG*");
    }
}

//! Player-count history per server, for the "players over time" chart.
//!
//! Two resolutions: one sample per 10 s for the last hour (in memory only),
//! and one per minute for the last 3 days (saved to history.json, so longer
//! windows survive a restart). A sample is the humans online (bots excluded);
//! an offline server records 0. Time when YAQS was closed has no samples and
//! shows as a gap, not as zero.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Mutex;

const FINE_MS: u64 = 10_000;
const FINE_KEEP: u64 = 360; // 1 hour of 10 s slots
const COARSE_MS: u64 = 60_000;
const COARSE_KEEP: u64 = 3 * 24 * 60; // 3 days of minutes

/// (slot index, humans): the highest count seen in that slot.
type Series = VecDeque<(u64, u16)>;

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    v: u8,
    servers: HashMap<String, Vec<(u64, u16)>>,
}

#[derive(Default)]
struct Data {
    fine: HashMap<String, Series>,
    coarse: HashMap<String, Series>,
    dirty: bool,
}

pub struct History {
    data: Mutex<Data>,
    path: Option<PathBuf>,
}

fn push(series: &mut Series, slot: u64, players: u16, keep: u64) {
    match series.back_mut() {
        Some((s, p)) if *s == slot => *p = (*p).max(players),
        _ => series.push_back((slot, players)),
    }
    while series.front().is_some_and(|(s, _)| *s + keep < slot) {
        series.pop_front();
    }
}

/// The samples whose slot overlaps [from, to) ms as (slot start ms, humans),
/// oldest first, counting only slots that end by `until` (so minutes never
/// spill into the 10 s record).
fn samples_in(series: Option<&Series>, slot_ms: u64, from: u64, to: u64, until: u64) -> Vec<(u64, u16)> {
    let Some(series) = series else { return vec![] };
    let (a, b) = (from / slot_ms, to.div_ceil(slot_ms));
    let mut out: Vec<(u64, u16)> = series
        .iter()
        .rev()
        .take_while(|(s, _)| *s >= a)
        .filter(|(s, _)| *s < b && (s + 1) * slot_ms <= until)
        .map(|&(s, p)| (s * slot_ms, p))
        .collect();
    out.reverse();
    out
}

/// Lowest and highest total over the servers' samples. Servers are sampled at
/// different moments, so at each sample time every server counts with its
/// latest sample (or its first one in the bar, before it has any). Adding up
/// per-server minimums or maximums would pair moments that never happened.
fn total_range(servers: &[Vec<(u64, u16)>]) -> Option<(u32, u32)> {
    let mut times: Vec<u64> = servers.iter().flatten().map(|(t, _)| *t).collect();
    times.sort_unstable();
    times.dedup();
    let mut at = vec![0usize; servers.len()];
    let mut range: Option<(u32, u32)> = None;
    for t in times {
        let mut total = 0u32;
        for (k, s) in servers.iter().enumerate() {
            while at[k] + 1 < s.len() && s[at[k] + 1].0 <= t {
                at[k] += 1;
            }
            total += s[at[k]].1 as u32;
        }
        let (lo, hi) = range.get_or_insert((total, total));
        *lo = (*lo).min(total);
        *hi = (*hi).max(total);
    }
    range
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chart {
    /// Unix ms where the first bar starts.
    pub start: u64,
    /// Width of each bar in ms.
    pub bucket: u64,
    /// Total humans per bar (sum over servers of each one's average), or
    /// null where no server has data (YAQS wasn't running).
    pub values: Vec<Option<f32>>,
    /// Lowest and highest total seen inside each bar (null where values is).
    pub lows: Vec<Option<u32>>,
    pub highs: Vec<Option<u32>>,
}

impl History {
    /// Loads the saved minute history from `path`, if any.
    pub fn load(path: Option<PathBuf>) -> Self {
        let mut data = Data::default();
        if let Some(saved) = path.as_ref().and_then(|p| std::fs::read(p).ok()).and_then(|b| serde_json::from_slice::<Saved>(&b).ok()) {
            let now = crate::poller::now_ms() / COARSE_MS;
            for (addr, points) in saved.servers {
                let series: Series = points.into_iter().filter(|(s, _)| s + COARSE_KEEP >= now).collect();
                if !series.is_empty() {
                    data.coarse.insert(addr, series);
                }
            }
        }
        History { data: Mutex::new(data), path }
    }

    pub fn record(&self, addr: &str, ts_ms: u64, players: u16) {
        let mut d = self.data.lock().unwrap();
        push(d.fine.entry(addr.to_string()).or_default(), ts_ms / FINE_MS, players, FINE_KEEP);
        push(d.coarse.entry(addr.to_string()).or_default(), ts_ms / COARSE_MS, players, COARSE_KEEP);
        d.dirty = true;
    }

    /// Totals for `addrs` over the last `window_ms`, split into `bars` bars.
    pub fn chart(&self, addrs: &[String], window_ms: u64, bars: usize, now_ms: u64) -> Chart {
        let bars = bars.clamp(1, 240);
        let bucket = (window_ms / bars as u64).max(1);
        let start = now_ms.saturating_sub(bucket * bars as u64);
        let d = self.data.lock().unwrap();
        let (mut values, mut lows, mut highs) = (Vec::with_capacity(bars), Vec::with_capacity(bars), Vec::with_capacity(bars));
        for i in 0..bars {
            let (from, to) = (start + i as u64 * bucket, start + (i as u64 + 1) * bucket);
            let servers: Vec<Vec<(u64, u16)>> = addrs
                .iter()
                .map(|a| {
                    // Short bars use the 10 s samples. Minutes fill in only
                    // time before the 10 s record starts (e.g. right after a
                    // restart); inside it, a missing sample really is a gap.
                    if bucket < COARSE_MS * 2 {
                        let fine = d.fine.get(a);
                        let got = samples_in(fine, FINE_MS, from, to, u64::MAX);
                        if !got.is_empty() {
                            return got;
                        }
                        let fine_from = fine.and_then(|f| f.front()).map(|(s, _)| s * FINE_MS).unwrap_or(u64::MAX);
                        samples_in(d.coarse.get(a), COARSE_MS, from, to, fine_from)
                    } else {
                        samples_in(d.coarse.get(a), COARSE_MS, from, to, u64::MAX)
                    }
                })
                .filter(|s| !s.is_empty())
                .collect();
            let avg = (!servers.is_empty()).then(|| {
                servers.iter().map(|s| s.iter().map(|(_, p)| *p as f32).sum::<f32>() / s.len() as f32).sum::<f32>()
            });
            let range = total_range(&servers);
            values.push(avg);
            lows.push(range.map(|r| r.0));
            highs.push(range.map(|r| r.1));
        }
        Chart { start, bucket, values, lows, highs }
    }

    /// Writes the minute history to disk if it changed.
    pub fn save(&self) {
        let Some(path) = &self.path else { return };
        let saved = {
            let mut d = self.data.lock().unwrap();
            if !d.dirty {
                return;
            }
            d.dirty = false;
            Saved {
                v: 1,
                servers: d.coarse.iter().map(|(a, s)| (a.clone(), s.iter().copied().collect())).collect(),
            }
        };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let tmp = path.with_extension("json.tmp");
        if serde_json::to_vec(&saved).ok().and_then(|b| std::fs::write(&tmp, b).ok()).is_some() {
            let _ = std::fs::rename(&tmp, path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn totals_and_gaps() {
        let h = History::load(None);
        let now = 10_000_000_000u64;
        // Two servers over the last 10 minutes; the first 5 minutes are a gap.
        for s in 0..30 {
            let ts = now - 300_000 + s * 10_000;
            h.record("a:1", ts, 10);
            h.record("b:1", ts, 5);
        }
        let c = h.chart(&["a:1".into(), "b:1".into()], 600_000, 10, now);
        assert_eq!(c.values.len(), 10);
        assert!(c.values[..5].iter().all(|v| v.is_none()), "{:?}", c.values);
        assert!(c.values[5..].iter().all(|v| *v == Some(15.0)), "{:?}", c.values);
        // Only the selected servers count.
        let only_a = h.chart(&["a:1".into()], 600_000, 10, now);
        assert_eq!(only_a.values[9], Some(10.0));
    }

    #[test]
    fn bar_lows_and_highs_are_of_the_total() {
        let h = History::load(None);
        let now = 10_000_000_000u64;
        // One 60 s bar. a: 10 then 20; b: 30 then 0, sampled at other moments.
        let bar = now - 60_000;
        h.record("a:1", bar + 1_000, 10);
        h.record("b:1", bar + 15_000, 30);
        h.record("a:1", bar + 31_000, 20);
        h.record("b:1", bar + 45_000, 0);
        let c = h.chart(&["a:1".into(), "b:1".into()], 60_000, 1, now);
        // Totals: 10+30 (b's first sample stands in before it), 10+30, 20+30,
        // 20+0. Summing per-server minimums would give 10+0, which never happened.
        assert_eq!((c.lows[0], c.highs[0]), (Some(20), Some(50)));
        assert_eq!(c.values[0], Some(15.0 + 15.0));
        let gap = h.chart(&["a:1".into()], 120_000, 2, now);
        assert_eq!((gap.values[0], gap.lows[0], gap.highs[0]), (None, None, None));
    }

    #[test]
    fn saves_and_reloads_minutes() {
        let dir = std::env::temp_dir().join(format!("yaqs-hist-{}", std::process::id()));
        let path = dir.join("history.json");
        let now = crate::poller::now_ms();
        let h = History::load(Some(path.clone()));
        h.record("a:1", now - 120_000, 7);
        h.record("a:1", now - 60_000, 9);
        h.save();
        let back = History::load(Some(path));
        let c = back.chart(&["a:1".into()], 4 * 3_600_000, 240, now);
        assert!(c.values.iter().flatten().any(|v| *v == 9.0), "{:?}", c.values.iter().flatten().collect::<Vec<_>>());
        let _ = std::fs::remove_dir_all(dir);
    }
}

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

/// Average of the samples whose slot overlaps [from, to) ms, counting only
/// slots that end by `until` (so minutes never spill into the 10 s record).
fn avg_in(series: Option<&Series>, slot_ms: u64, from: u64, to: u64, until: u64) -> Option<f32> {
    let series = series?;
    let (a, b) = (from / slot_ms, to.div_ceil(slot_ms));
    let (mut sum, mut n) = (0u32, 0u32);
    for &(s, p) in series.iter().rev() {
        if s < a {
            break;
        }
        if s < b && (s + 1) * slot_ms <= until {
            sum += p as u32;
            n += 1;
        }
    }
    (n > 0).then(|| sum as f32 / n as f32)
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
        let values = (0..bars)
            .map(|i| {
                let (from, to) = (start + i as u64 * bucket, start + (i as u64 + 1) * bucket);
                let mut total: Option<f32> = None;
                for a in addrs {
                    // Short bars use the 10 s samples. Minutes fill in only
                    // time before the 10 s record starts (e.g. right after a
                    // restart); inside it, a missing sample really is a gap.
                    let fine = d.fine.get(a);
                    let fine_from = fine.and_then(|f| f.front()).map(|(s, _)| s * FINE_MS).unwrap_or(u64::MAX);
                    let v = if bucket < COARSE_MS * 2 {
                        avg_in(fine, FINE_MS, from, to, u64::MAX)
                            .or_else(|| avg_in(d.coarse.get(a), COARSE_MS, from, to, fine_from))
                    } else {
                        avg_in(d.coarse.get(a), COARSE_MS, from, to, u64::MAX)
                    };
                    if let Some(v) = v {
                        *total.get_or_insert(0.0) += v;
                    }
                }
                total
            })
            .collect();
        Chart { start, bucket, values }
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

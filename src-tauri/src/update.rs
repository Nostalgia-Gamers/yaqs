//! Updates from GitHub Releases, on two channels:
//! - stable: /releases/latest/download/latest.json (never a pre-release)
//! - beta:   the channel-beta release's latest.json, which CI points at the
//!   newest pre-release or stable version, whichever is newer.
//!
//! Installed copies update through tauri-plugin-updater (NSIS installer). A
//! portable copy has no installer: it downloads the new portable exe from the
//! same release, checks it against the updater's public key, swaps it in place
//! and restarts. Its YAQS-data folder sits next to the exe and is left alone.

use base64::Engine;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

const STABLE: &str = "https://github.com/Nostalgia-Gamers/yaqs/releases/latest/download/latest.json";
const BETA: &str = "https://github.com/Nostalgia-Gamers/yaqs/releases/download/channel-beta/latest.json";
const PORTABLE: &str = "windows-x86_64-portable";

fn manifest_url(channel: &str) -> &'static str {
    if channel == "beta" { BETA } else { STABLE }
}

#[derive(Deserialize)]
struct Manifest {
    version: String,
    platforms: HashMap<String, Asset>,
}

#[derive(Deserialize)]
struct Asset {
    signature: String,
    url: String,
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .user_agent("YAQS updater")
        .build()
        .expect("http client")
}

fn parse_version(v: &str) -> Result<semver::Version, String> {
    semver::Version::parse(v.trim().trim_start_matches('v')).map_err(|e| format!("bad version {v}: {e}"))
}

/// The newer version on `channel`, if any.
pub async fn check(app: &AppHandle, channel: &str, portable: bool) -> Result<Option<String>, String> {
    if portable {
        return Ok(newer_portable(app, channel).await?.map(|(v, _)| v));
    }
    Ok(installer_updater(app, channel)?.check().await.map_err(|e| e.to_string())?.map(|u| u.version))
}

/// Downloads, verifies and installs the newer version on `channel`, then
/// restarts YAQS. Does nothing if there's no newer version.
pub async fn install(app: &AppHandle, channel: &str, portable: bool) -> Result<(), String> {
    if portable {
        return install_portable(app, channel).await;
    }
    let Some(update) = installer_updater(app, channel)?.check().await.map_err(|e| e.to_string())? else {
        return Ok(());
    };
    // On Windows the installer closes YAQS itself and starts the new version.
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

fn installer_updater(app: &AppHandle, channel: &str) -> Result<tauri_plugin_updater::Updater, String> {
    let url = manifest_url(channel).parse().map_err(|e: url::ParseError| e.to_string())?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

/// The newest release's portable asset on `channel`, if newer than this build.
async fn newer_portable(app: &AppHandle, channel: &str) -> Result<Option<(String, Asset)>, String> {
    let m: Manifest = http().get(manifest_url(channel)).send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    let current = parse_version(&app.package_info().version.to_string())?;
    if parse_version(&m.version)? <= current {
        return Ok(None);
    }
    let mut platforms = m.platforms;
    Ok(platforms.remove(PORTABLE).map(|a| (m.version, a)))
}

/// Verifies `data` against a base64 minisign signature using the updater's
/// public key from tauri.conf.json, exactly as tauri-plugin-updater does.
fn verify(app: &AppHandle, data: &[u8], signature: &str) -> Result<(), String> {
    let b64 = base64::engine::general_purpose::STANDARD;
    let pubkey = app.config().plugins.0.get("updater")
        .and_then(|u| u.get("pubkey")).and_then(|k| k.as_str())
        .ok_or("updater public key missing")?;
    let pubkey = String::from_utf8(b64.decode(pubkey).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let sig = String::from_utf8(b64.decode(signature.trim()).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let pk = minisign_verify::PublicKey::decode(&pubkey).map_err(|e| e.to_string())?;
    let sig = minisign_verify::Signature::decode(&sig).map_err(|e| e.to_string())?;
    pk.verify(data, &sig, true).map_err(|_| "signature does not match: refusing the update".to_string())
}

fn old_path(exe: &Path) -> PathBuf {
    exe.with_extension("exe.old")
}

/// Removes the previous exe left behind by a portable update (it was still running then).
pub fn cleanup() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(old_path(&exe));
    }
}

async fn install_portable(app: &AppHandle, channel: &str) -> Result<(), String> {
    let Some((_, asset)) = newer_portable(app, channel).await? else { return Ok(()) };
    let bytes = http().get(&asset.url).send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?
        .bytes().await.map_err(|e| e.to_string())?;
    verify(app, &bytes, &asset.signature)?;

    // A running exe can't be overwritten on Windows, but it can be renamed.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let new = exe.with_extension("exe.new");
    std::fs::write(&new, &bytes).map_err(|e| format!("can't write the update next to the exe: {e}"))?;
    let old = old_path(&exe);
    let _ = std::fs::remove_file(&old);
    std::fs::rename(&exe, &old).map_err(|e| e.to_string())?;
    if let Err(e) = std::fs::rename(&new, &exe) {
        let _ = std::fs::rename(&old, &exe); // put the current version back
        return Err(e.to_string());
    }

    relaunch_after_exit(&exe)?;
    app.exit(0);
    Ok(())
}

/// Starts `exe` a moment after this process exits: both would otherwise fight
/// over the WebView data folder.
#[cfg(windows)]
fn relaunch_after_exit(exe: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

    // raw_arg, not arg: Rust would escape the quotes as \" , which cmd.exe
    // doesn't understand, and `start` would silently fail.
    let line = format!("/C ping 127.0.0.1 -n 2 >nul & start \"\" \"{}\"", exe.display());
    let spawn = |flags: u32| std::process::Command::new("cmd").raw_arg(&line).creation_flags(flags).spawn();
    // Leave any job object we were started in, so the relauncher survives our
    // exit; some launchers' jobs forbid that, so fall back to staying in it.
    spawn(CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB)
        .or_else(|_| spawn(CREATE_NO_WINDOW | DETACHED_PROCESS))
        .map(|_| ())
        .map_err(|e| format!("can't restart YAQS: {e}"))
}

#[cfg(not(windows))]
fn relaunch_after_exit(exe: &Path) -> Result<(), String> {
    std::process::Command::new(exe).spawn().map(|_| ()).map_err(|e| e.to_string())
}

//! Self-update for the portable exe. The installed app updates through
//! tauri-plugin-updater (NSIS installer); a portable copy has no installer, so
//! it downloads the new portable exe from the same release, checks it against
//! the updater's public key, swaps it in place and restarts. Its YAQS-data
//! folder sits next to the exe and is left alone.

use base64::Engine;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::AppHandle;

const MANIFEST: &str = "https://github.com/Nostalgia-Gamers/yaqs/releases/latest/download/latest.json";
const PLATFORM: &str = "windows-x86_64-portable";

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

/// The newest release's portable asset, if it's newer than this build.
async fn newer(app: &AppHandle) -> Result<Option<(String, Asset)>, String> {
    let m: Manifest = http().get(MANIFEST).send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    let current = parse_version(&app.package_info().version.to_string())?;
    if parse_version(&m.version)? <= current {
        return Ok(None);
    }
    let mut platforms = m.platforms;
    Ok(platforms.remove(PLATFORM).map(|a| (m.version, a)))
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

/// Removes the previous exe left behind by an update (it was still running then).
pub fn cleanup() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(old_path(&exe));
    }
}

/// Returns the newer version available for this portable exe, if any.
pub async fn check(app: &AppHandle) -> Result<Option<String>, String> {
    Ok(newer(app).await?.map(|(v, _)| v))
}

/// Downloads, verifies and swaps in the new exe, then restarts YAQS.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let Some((_, asset)) = newer(app).await? else { return Ok(()) };
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

    // Start the new exe a moment after this one exits: both would otherwise
    // fight over the WebView data folder.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let script = format!("ping 127.0.0.1 -n 2 >nul & start \"\" \"{}\"", exe.display());
        std::process::Command::new("cmd")
            .args(["/C", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    app.exit(0);
    Ok(())
}

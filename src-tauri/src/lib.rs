mod a2s;
mod addr;
mod discover;
mod geo;
mod history;
mod master;
mod poller;
mod update;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};

struct AppState {
    poller: poller::Poller,
    master: master::Client,
    history: Arc<history::History>,
}

/// Replaces the set of watched servers, each with its own interval (s).
/// Results arrive as "updates" events. Returns refused addresses.
#[tauri::command]
fn set_watch(state: State<'_, AppState>, items: Vec<poller::WatchItem>) -> Vec<String> {
    state.poller.set_watch(items)
}

#[tauri::command]
async fn rules(state: State<'_, AppState>, addr: String) -> Result<Vec<a2s::Rule>, String> {
    let addr = addr::parse_addr(&addr).ok_or("invalid address")?;
    state.poller.rules(addr).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn discover(input: String) -> discover::Discovery {
    discover::discover(input).await
}

/// Total players of `addrs` over the last `window` seconds, in `bars` bars.
#[tauri::command]
fn players_history(state: State<'_, AppState>, addrs: Vec<String>, window: u64, bars: usize) -> history::Chart {
    state.history.chart(&addrs, window.clamp(60, 3 * 86_400) * 1000, bars, poller::now_ms())
}

/// Where this copy keeps its files: YAQS-data next to a portable exe, or the
/// app's data folder for an installed one.
fn data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    portable_data_dir().or_else(|| app.path().app_data_dir().ok())
}

/// Registers the app's notification identity (AppUserModelID) for this user.
/// Windows drops toasts from an ID it doesn't know; the installer's Start menu
/// shortcut registers it, but a portable copy has no shortcut.
#[cfg(windows)]
fn register_notifications(app: &tauri::AppHandle) {
    let id = app.config().identifier.clone();
    let icon = data_dir(app).map(|d| d.join("notification-icon.png"));
    if let Some(icon) = &icon {
        let _ = std::fs::create_dir_all(icon.parent().unwrap_or(icon));
        let _ = std::fs::write(icon, include_bytes!("../icons/128x128.png"));
    }
    if let Ok(key) = windows_registry::CURRENT_USER.create(format!(r"Software\Classes\AppUserModelId\{id}")) {
        let _ = key.set_string("DisplayName", "YAQS");
        if let Some(icon) = icon {
            let _ = key.set_string("IconUri", icon.display().to_string());
        }
    }
}

/// Whether this copy runs in portable mode (it updates itself, not via the installer).
#[tauri::command]
fn is_portable() -> bool {
    portable_data_dir().is_some()
}

#[tauri::command]
async fn portable_update_check(app: tauri::AppHandle) -> Result<Option<String>, String> {
    update::check(&app).await
}

#[tauri::command]
async fn portable_update_install(app: tauri::AppHandle) -> Result<(), String> {
    update::install(&app).await
}

#[tauri::command]
async fn browse(state: State<'_, AppState>, key: String, filter: master::Filter) -> Result<Vec<master::Server>, String> {
    let servers = state.master.list(&key, &filter).await?;
    Ok(servers.into_iter().filter(|s| addr::parse_addr(&s.addr).is_some()).collect())
}

/// Portable mode: when the exe's name contains "portable", the server list
/// and settings live in a YAQS-data folder next to it instead of %LOCALAPPDATA%,
/// so the app and its data travel together (e.g. on a USB stick).
fn portable_data_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let name = exe.file_name()?.to_string_lossy().to_lowercase();
    name.contains("portable").then(|| exe.parent().map(|d| d.join("YAQS-data")))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if portable_data_dir().is_some() {
                update::cleanup();
            }
            let geo = geo::Resolver::new();
            tauri::async_runtime::spawn(geo.clone().run());

            #[cfg(windows)]
            register_notifications(app.handle());

            let history = Arc::new(history::History::load(data_dir(app.handle()).map(|d| d.join("history.json"))));
            let saver = history.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(300)).await;
                    saver.save();
                }
            });

            let poller = poller::Poller::new(
                a2s::Client::new(Duration::from_millis(1500), 1),
                Some(geo),
                Some(history.clone()),
                poller::Config { min_interval: Duration::from_secs(1), max_inflight: 256, fail_threshold: 2 },
            );
            let handle = app.handle().clone();
            let sink: poller::Sink = Arc::new(move |batch| {
                let _ = handle.emit("updates", batch);
            });
            tauri::async_runtime::spawn(poller.clone().run(sink));

            app.manage(AppState { poller, master: master::Client::new(), history });

            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("YAQS")
                .inner_size(1440.0, 880.0)
                .min_inner_size(900.0, 560.0);
            if let Some(dir) = portable_data_dir() {
                window = window.data_directory(dir);
            }
            window.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_watch, rules, discover, browse, players_history, is_portable, portable_update_check, portable_update_install
        ])
        .build(tauri::generate_context!())
        .expect("error while running YAQS")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<AppState>().history.save();
            }
        });
}

# YAQS Desktop

YAQS ("Yet Another Query Server") as an installed Windows app: a live game-server watcher in the spirit of HLSW, built with **Tauri 2 + Rust + React**. There's no separate server. Rust sends the A2S queries straight from your PC and pushes results to the UI, so it's one small, efficient app.

It works with any game that speaks Valve's A2S protocol: GoldSrc (CS 1.6, CZ, DoD, TFC, HL) and Source/Source 2 (CS:S, CS2, TF2, GMod, L4D2, Rust…). LAN servers work too.

## Features

- **Refresh like HLSW:** your list every 2 s (configurable) and the selected server every second. Rows flash **green** when players join or a server comes back, **red** when players leave or it goes down, and **blue** on a map change.
- **HLSW-style info box:** ping graph with average, location (flag, country, ISP), game, players, map and next map, time left, limits, friendly fire, addons (AMX Mod X, Metamod, ReAPI, ReUnion, SourceMod…), version and contact. Players and rules (cvars) are tabs below it.
- **Two languages:** Español (Argentina) and English. YAQS follows the Windows language by default; change it under ⚙ Options → Language.
- **Right-click menu:** connect, show details, copy the address or the `connect` command, favorite, move to a category, edit, remove. It acts on the clicked server or on the whole selection.
- **Bulk edit:** select several servers and use Edit to change category, favorite, reserved slots, tags or notes at once. Fields you don't touch keep each server's value.
- **Reserved slots:** per server. A server counts as full once max players minus reserved slots are taken. That sets the amber bar and the **Full** badge, drives "Hide full", and puts a tick on the meter.
- **Organizing:** categories, tags, favorites, aliases and notes. You can drag rows onto a category or tag, and multi-select (Ctrl/Shift-click) for bulk changes. Columns are sortable, including address (numeric IP:port).
- **Adding servers:** paste an IP alone and YAQS scans ports 27000–27060 and 28015–28017. Ranges (`ip:27015-27030`) and lists (`ip:27015,27017`) work too. You get a preview before anything is added.
- **Browse Steam's master list:** needs a free Steam Web API key, entered in Settings and stored only on this PC. You can save searches and "Add all" to import a whole community.
- **Buddies and alerts:** see where friends are playing, and get alerted on down, up, N+ players, or a map change. Alerts show as in-app toasts, with optional Windows notifications and sound.
- **Wall mode:** big cards per category for a second screen. The window title shows `⚠down (players)`.
- **Export/import:** a JSON server pack, compatible with the web version of YAQS.

## Download

Always the newest version:

- Installer: https://github.com/Nostalgia-Gamers/yaqs/releases/latest/download/YAQS_x64-setup.exe
- Portable: https://github.com/Nostalgia-Gamers/yaqs/releases/latest/download/YAQS_x64-portable.exe

## Updates

YAQS checks for a newer version when it starts and every 6 hours. If it finds one, it downloads it, verifies its signature against the public key built into the app, installs it and restarts:

- **Installed copies** update through Tauri's updater, which runs the new installer in passive mode.
- **Portable copies** download the new portable exe, swap their own file and keep `YAQS-data`.

There are two channels, chosen in Settings → Updates:

| Channel | Gets | Reads |
|---|---|---|
| **Stable** | tested releases (`v1.2.3`) | `/releases/latest/download/latest.json` (GitHub never counts a pre-release as "latest") |
| **Beta** | pre-releases (`v1.2.3-beta.1`) first, then the stable version when it's out | `/releases/download/channel-beta/latest.json` |

"Automatic" (the default) follows Beta when the running version is a pre-release, and Stable otherwise. So installing a beta once puts that PC on the beta channel. YAQS never downgrades: switching back to Stable waits for the next stable version.

## Releasing

Work happens on `develop`. `master` only gets what's ready for everyone.

1. **Beta, for testing:** on `develop`, tag and push, e.g. `git tag v0.2.0-beta.1 && git push origin develop v0.2.0-beta.1`.
   - CI publishes a pre-release and moves the beta channel to it, so beta installs update.
   - Stable installs don't see it.
2. **Iterate:** fix things and tag `v0.2.0-beta.2`, `-beta.3`… as needed.
3. **Stable, for everyone:** merge `develop` into `master`, then tag the same version without the suffix: `git checkout master && git merge develop && git tag v0.2.0 && git push origin master v0.2.0`.
   - Everyone updates, including beta installs, because `0.2.0` is newer than `0.2.0-beta.N`.

For each tag, the **Build** workflow:
- runs the checks;
- builds on `windows-latest`;
- publishes the release with the installer, the portable exe, their `.sig` signatures, `latest.json`, always-latest copies and `SHA256SUMS.txt`.

A stable tag must point to a commit on `master`.

The tag decides the version (`tools/release_version.py`, strict semver, as in nginmod). A release that already exists is never overwritten.

Updates are signed with the key in the `TAURI_SIGNING_PRIVATE_KEY` repository secret. The same key lives in `%USERPROFILE%\.tauri\yaqs.key` on the maintainer's PC. **Back it up:** without it, no update can ever reach existing installs again, and you'd have to ship a new public key and ask everyone to reinstall.

## Portable

`YAQS_<version>_x64-portable.exe` is a single file that needs no install. Any copy of the exe whose name contains "portable" keeps its server list and settings in a `YAQS-data` folder next to itself instead of `%LOCALAPPDATA%`, so the app and its data move together, for example on a USB stick. It needs the WebView2 runtime, which Windows 10 and 11 already include.

## Build

You need Node 20+, Rust (rustup, MSVC toolchain), and Visual Studio Build Tools with "Desktop development with C++".

```sh
npm install
npm run tauri dev      # run with hot reload
npm run tauri build    # installers in src-tauri/target/release/bundle/{nsis,msi}
npm run build:portable # same, plus bundle/portable/YAQS_<version>_x64-portable.exe
cd src-tauri && cargo test
```

## Layout

```
src-tauri/src/a2s.rs       A2S client: challenges, GoldSrc + Source split packets, bzip2
src-tauri/src/poller.rs    per-server intervals, batched "updates" events to the UI
src-tauri/src/discover.rs  IP-only port scan, ranges and lists for the add box
src-tauri/src/addr.rs      input parsing, DNS
src-tauri/src/geo.rs       batched, cached country/ISP lookups (ip-api.com, non-commercial tier)
src-tauri/src/master.rs    Steam Web API GetServerList with a 60 s cache
src-tauri/src/lib.rs       Tauri commands: set_watch, rules, discover, browse
src/                       React UI (zustand state, saved to localStorage)
```

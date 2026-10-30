#!/usr/bin/env python3
"""Write latest.json, the manifest the app reads to update itself.

The installed app reads platforms["windows-x86_64"] (tauri-plugin-updater runs
the NSIS installer). The portable exe reads platforms["windows-x86_64-portable"]
(src-tauri/src/update.rs swaps its own exe). Each signature is the content of
the .sig file `tauri build` / `tauri signer sign` wrote next to the binary.

Usage: python3 tools/update_manifest.py <version> <repository> <dist dir>
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def asset(dist: Path, name: str, tag: str, repo: str) -> dict:
    sig = dist / f"{name}.sig"
    if not (dist / name).is_file() or not sig.is_file():
        raise SystemExit(f"update_manifest: {name} or its .sig is missing from {dist}")
    return {
        "signature": sig.read_text().strip(),
        "url": f"https://github.com/{repo}/releases/download/{tag}/{name}",
    }


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    version, repo, dist = argv[1], argv[2], Path(argv[3])
    tag = f"v{version}"
    manifest = {
        "version": version,
        "notes": f"https://github.com/{repo}/releases/tag/{tag}",
        "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {
            "windows-x86_64": asset(dist, f"YAQS_{version}_x64-setup.exe", tag, repo),
            "windows-x86_64-portable": asset(dist, f"YAQS_{version}_x64-portable.exe", tag, repo),
        },
    }
    (dist / "latest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

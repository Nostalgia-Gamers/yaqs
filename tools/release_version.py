#!/usr/bin/env python3
"""Turn a git ref into the version a build reports.

A tag `refs/tags/v1.2.0` gives `1.2.0`. Any ref that is not a tag gives
`0.0.0-dev`. A tag that is not strict semver is an error: the build must stop,
because the alternative is a release binary that reports `0.0.0-dev`.

Usage: python3 tools/release_version.py <ref>
Exit:  0 and the version on stdout, or 2 and the reason on stderr.
"""

from __future__ import annotations

import re
import sys

DEV = "0.0.0-dev"

_NUM = r"(?:0|[1-9][0-9]*)"
_ID = r"(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
_TAG = re.compile(rf"refs/tags/v({_NUM}\.{_NUM}\.{_NUM}(?:-{_ID}(?:\.{_ID})*)?)")


def version_from_ref(ref: str) -> str:
    if not ref.startswith("refs/tags/"):
        return DEV
    match = _TAG.fullmatch(ref)
    if match is None:
        raise ValueError(
            f"tag '{ref[len('refs/tags/'):]}' is not strict semver: "
            "use vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-prerelease"
        )
    return match.group(1)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: release_version.py <ref>", file=sys.stderr)
        return 2
    try:
        print(version_from_ref(argv[1]))
    except ValueError as err:
        print(f"release_version: {err}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

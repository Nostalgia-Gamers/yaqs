#!/usr/bin/env python3
"""Exit 0 if version A is newer than version B under semver precedence.

Used by CI to move the beta channel only forward: a stable hotfix (0.1.3)
must not replace a newer beta (0.2.0-beta.1) as the beta channel's version.

Usage: python3 tools/semver_newer.py <A> <B>
Exit:  0 if A > B, 1 otherwise, 2 on a malformed version.
"""

from __future__ import annotations

import re
import sys

_SEMVER = re.compile(r"v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?")


def key(v: str) -> tuple:
    m = _SEMVER.fullmatch(v.strip())
    if m is None:
        raise ValueError(f"not semver: {v!r}")
    core = tuple(int(x) for x in m.group(1, 2, 3))
    pre = m.group(4)
    if pre is None:
        return core + ((1,),)  # a release sorts after any of its pre-releases
    ids = tuple((0, int(p), "") if p.isdigit() else (1, 0, p) for p in pre.split("."))
    return core + ((0,) + ids,)


def newer(a: str, b: str) -> bool:
    return key(a) > key(b)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        return 0 if newer(argv[1], argv[2]) else 1
    except ValueError as err:
        print(f"semver_newer: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))

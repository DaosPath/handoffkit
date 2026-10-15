"""On-demand loader for the large doctor-benchmark case sets.

Only the 30-case set ships inside the wheel. The 100- and 400-case sets stay in
the source repository and are fetched on first use from a pinned commit, then
verified by SHA-256 and cached. A source checkout uses its local copy directly.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import urllib.request
from pathlib import Path
from typing import Any

_PINNED_COMMIT = "e9522482609a90ed04933c9b1a006cc32fa25e58"
_REPO_PATH = "python/packages/handoffkit/handoffkit/benchmarks/data"
_RAW_BASE = f"https://raw.githubusercontent.com/DaosPath/handoffkit/{_PINNED_COMMIT}/{_REPO_PATH}"

REMOTE_CASE_SETS: dict[str, str] = {
    "doctor_cases_100.json": "fb6c6578945babef2764e721bedce0e3c23cf48d2c1b4e5151340d738b7c3bfe",
    "doctor_cases_400.json": "bfe6bdbbdd192c3746746b2d00fd2ec52df4b079cb43932b70b792e63c433ba7",
}

_LOCAL_DATA = Path(__file__).resolve().parent / "data"


class CaseSetUnavailableError(RuntimeError):
    """Raised when a large case set is neither local, cached, nor downloadable."""


def cache_dir() -> Path:
    """Return the benchmark cache directory (``HANDOFFKIT_CACHE_DIR`` overrides)."""
    root = os.environ.get("HANDOFFKIT_CACHE_DIR")
    if root:
        return Path(root) / "benchmarks"
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
    return base / "handoffkit" / "benchmarks"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_case_set(name: str) -> list[dict[str, Any]]:
    """Load a large case set from the checkout, the cache, or the pinned URL."""
    expected = REMOTE_CASE_SETS.get(name)
    if expected is None:
        raise KeyError(f"unknown case set: {name}")

    local = _LOCAL_DATA / name
    if local.is_file():
        return json.loads(local.read_text(encoding="utf-8"))

    cached = cache_dir() / name
    if cached.is_file() and _sha256(cached.read_bytes()) == expected:
        return json.loads(cached.read_text(encoding="utf-8"))

    url = f"{_RAW_BASE}/{name}"
    if os.environ.get("HANDOFFKIT_OFFLINE") == "1":
        raise CaseSetUnavailableError(
            f"{name} is not bundled in the wheel and HANDOFFKIT_OFFLINE=1 blocks the "
            f"download. Fetch {url} into {cached} or use the 30-case set."
        )
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "handoffkit-benchmarks"})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read()
    except OSError as exc:
        raise CaseSetUnavailableError(
            f"could not download {name} from {url}: {exc}. "
            "Retry with network access or use the 30-case set."
        ) from exc
    digest = _sha256(data)
    if digest != expected:
        raise CaseSetUnavailableError(
            f"{name} checksum mismatch (expected {expected}, got {digest}); refusing to use it"
        )

    cached.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=cached.parent, prefix=f".{name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(tmp, cached)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return json.loads(data.decode("utf-8"))

from __future__ import annotations

import hashlib
import io
import json

import pytest

from handoffkit.benchmarks import _remote_cases as rc


@pytest.fixture
def no_local_copy(monkeypatch, tmp_path):
    monkeypatch.setattr(rc, "_LOCAL_DATA", tmp_path / "missing")
    monkeypatch.setenv("HANDOFFKIT_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.delenv("HANDOFFKIT_OFFLINE", raising=False)
    return tmp_path


def _serve(monkeypatch, payload: bytes, calls: list[str]):
    def fake_urlopen(request, timeout):
        calls.append(request.full_url)
        return io.BytesIO(payload)

    monkeypatch.setattr(rc.urllib.request, "urlopen", fake_urlopen)


def test_downloads_verifies_and_caches(monkeypatch, no_local_copy):
    payload = json.dumps([{"case_id": "x"}]).encode("utf-8")
    monkeypatch.setitem(
        rc.REMOTE_CASE_SETS, "doctor_cases_100.json", hashlib.sha256(payload).hexdigest()
    )
    calls: list[str] = []
    _serve(monkeypatch, payload, calls)

    assert rc.load_case_set("doctor_cases_100.json") == [{"case_id": "x"}]
    assert len(calls) == 1 and calls[0].startswith(
        "https://raw.githubusercontent.com/DaosPath/handoffkit/"
    )
    assert (
        no_local_copy / "cache" / "benchmarks" / "doctor_cases_100.json"
    ).read_bytes() == payload

    monkeypatch.setenv("HANDOFFKIT_OFFLINE", "1")
    assert rc.load_case_set("doctor_cases_100.json") == [{"case_id": "x"}]
    assert len(calls) == 1  # served from cache, no second download


def test_checksum_mismatch_is_rejected_and_not_cached(monkeypatch, no_local_copy):
    calls: list[str] = []
    _serve(monkeypatch, b'[{"tampered": true}]', calls)

    with pytest.raises(rc.CaseSetUnavailableError, match="checksum mismatch"):
        rc.load_case_set("doctor_cases_400.json")
    assert not (no_local_copy / "cache" / "benchmarks" / "doctor_cases_400.json").exists()


def test_offline_mode_fails_closed_without_cache(monkeypatch, no_local_copy):
    monkeypatch.setenv("HANDOFFKIT_OFFLINE", "1")
    calls: list[str] = []
    _serve(monkeypatch, b"[]", calls)

    with pytest.raises(rc.CaseSetUnavailableError, match="HANDOFFKIT_OFFLINE=1"):
        rc.load_case_set("doctor_cases_100.json")
    assert calls == []


def test_unknown_case_set_is_rejected():
    with pytest.raises(KeyError):
        rc.load_case_set("doctor_cases_9999.json")


def test_importing_case_modules_never_downloads(monkeypatch):
    def forbidden(*_args, **_kwargs):
        raise AssertionError("import must not trigger a download")

    monkeypatch.setattr(rc.urllib.request, "urlopen", forbidden)
    import importlib

    import handoffkit.benchmarks.cases as cases
    import handoffkit.benchmarks.doctor_cases_400 as c400

    importlib.reload(c400)
    importlib.reload(cases)
    assert len(cases.DOCTOR_CASES_30) == 30

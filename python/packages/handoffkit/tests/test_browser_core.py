from __future__ import annotations

import json
from pathlib import Path

import pytest

from handoffkit.browser.core import (
    CONTRACT_VERSION,
    PLATFORM_SEARCH_PROVIDERS,
    BrowserCapabilities,
    BrowserCoreError,
    BrowserError,
    BrowserPolicy,
    classify_network_target,
    parse_core_model,
    redact_sensitive,
)

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
VECTORS = json.loads(
    (CONTRACTS / "conformance" / "browser-core-v1.json").read_text(encoding="utf-8")
)

MODEL_FILES = {
    "browser_error": "BrowserError",
    "browser_capabilities": "BrowserCapabilities",
    "browser_policy": "BrowserPolicy",
    "browser_session_request": "BrowserSessionRequest",
    "browser_session_state": "BrowserSessionState",
    "browser_command": "BrowserCommand",
    "browser_event": "BrowserEvent",
    "search_request": "SearchRequest",
    "search_result": "SearchResult",
    "page_snapshot": "PageSnapshot",
    "document_record": "DocumentRecord",
    "provider_trace": "ProviderTrace",
    "research_job": "ResearchJob",
    "research_progress": "ResearchProgress",
    "research_result": "ResearchResult",
}


@pytest.mark.parametrize("key, model_name", MODEL_FILES.items())
def test_golden_round_trip(key: str, model_name: str) -> None:
    expected = VECTORS["vectors"][key]
    parsed = parse_core_model(model_name, expected)
    assert parsed.to_wire() == expected


@pytest.mark.parametrize("case", VECTORS["negative"], ids=lambda case: case["id"])
def test_negative_vectors(case: dict[str, object]) -> None:
    with pytest.raises(BrowserCoreError) as raised:
        parse_core_model(str(case["model"]), case["input"])  # type: ignore[arg-type]
    assert raised.value.code == case["error_code"]


def test_core_product_strips_engine_claims() -> None:
    caps = BrowserCapabilities.from_wire(
        {
            "product": "core",
            "engine": "chromium",
            "engine_ready": True,
            "probed_at": "2026-01-01T00:00:00Z",
            "javascript": True,
        }
    )
    assert caps.engine == ""
    assert caps.engine_ready is False
    assert caps.javascript is False


def test_public_bind_rejected() -> None:
    policy = BrowserPolicy.from_wire({})
    with pytest.raises(BrowserCoreError) as raised:
        policy.reject_public_bind("0.0.0.0")
    assert raised.value.code == "public_bind_rejected"
    assert policy.reject_public_bind("127.0.0.1") is True


def test_network_and_filesystem_policy() -> None:
    policy = BrowserPolicy.from_wire({})
    assert classify_network_target("http://127.0.0.1/")["kind"] == "loopback"
    assert classify_network_target("http://10.0.0.5/")["kind"] == "private"
    with pytest.raises(BrowserCoreError) as raised:
        policy.assert_network_url("http://192.168.1.8/")
    assert raised.value.code == "policy_denied"
    assert policy.assert_network_url("https://example.org/") is True
    with pytest.raises(BrowserCoreError) as fs_raised:
        policy.assert_filesystem("read")
    assert fs_raised.value.code == "policy_denied"
    assert policy.assert_filesystem("download") is True


def test_redaction() -> None:
    redacted = redact_sensitive(
        {"cookie": "sid=1", "nested": {"authorization": "Bearer x", "title": "ok"}}
    )
    assert redacted["cookie"] == "[redacted]"
    assert redacted["nested"]["authorization"] == "[redacted]"
    assert redacted["nested"]["title"] == "ok"


def test_share_cookies_and_cgnat() -> None:
    with pytest.raises(BrowserCoreError) as raised:
        BrowserPolicy.from_wire({"credentials": {"share_cookies": True}})
    assert raised.value.code == "profile_denied"
    assert classify_network_target("http://100.64.0.1/")["kind"] == "private"
    assert classify_network_target("http://224.0.0.1/")["kind"] == "private"
    assert classify_network_target("http://[::ffff:10.1.2.3]/")["kind"] == "private"
    command = parse_core_model(
        "BrowserCommand",
        {
            "contract_version": CONTRACT_VERSION,
            "command_id": "cmd-pause-1",
            "request_id": "req-1",
            "session_id": "sess-1",
            "name": "session.pause",
            "issued_at": "2026-01-01T00:00:00Z",
            "deadline_at": "",
            "idempotency_key": "",
            "payload": {},
        },
    )
    assert command.name == "session.pause"
    error = parse_core_model(
        "BrowserError",
        {
            "contract_version": CONTRACT_VERSION,
            "code": "download_too_large",
            "message": "download exceeded 50 MiB",
            "retryable": False,
            "details": {},
            "request_id": "req-1",
            "command_id": "cmd-1",
            "session_id": "sess-1",
            "occurred_at": "2026-01-01T00:00:00Z",
        },
    )
    assert error.code == "download_too_large"


def test_unknown_error_code() -> None:
    with pytest.raises(BrowserCoreError) as raised:
        BrowserError.from_wire({"code": "made_up"})
    assert raised.value.code == "invalid_request"


def test_platform_provider_order() -> None:
    assert list(PLATFORM_SEARCH_PROVIDERS) == [
        "google_browser",
        "project_index",
        "google_http",
        "duckduckgo",
        "wikipedia",
    ]
    assert CONTRACT_VERSION == "1.20.0-alpha.1"

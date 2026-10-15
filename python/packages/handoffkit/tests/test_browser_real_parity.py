"""Parity: new actuation + touch commands flow through the Python Real bridge."""

from __future__ import annotations

from handoffkit.browser.core import BrowserCommand
from handoffkit.browser.real_client import BrowserRealClient

COMMANDS = [
    ("hover", {"selector": "button"}),
    ("focus", {"selector": "input"}),
    ("check", {"selector": "input"}),
    ("uncheck", {"selector": "input"}),
    ("dblclick", {"selector": "button"}),
    ("scroll", {"selector": "main"}),
    ("scroll", {"by": 400}),
    ("upload", {"selector": "input", "path": "/tmp/a.txt"}),
    ("tap", {"selector": "button"}),
    ("swipe", {"direction": "up", "distance": 200}),
    ("longpress", {"duration_ms": 300}),
    ("pinch", {"scale": 2}),
    ("drag", {"from_selector": "a", "to_selector": "b"}),
]

BASE = {
    "contract_version": "1.20",
    "command_id": "c1",
    "request_id": "r1",
    "session_id": "s1",
    "issued_at": "2026-01-01T00:00:00Z",
    "deadline_at": "2026-01-01T00:01:00Z",
}


def _dispatch_recorder(seen):
    def dispatch(wire):
        seen.append(wire)
        return {
            "event_id": f"e-{wire.get('command_id')}",
            "name": "action.done",
            "command_id": wire.get("command_id"),
            "session_id": wire.get("session_id"),
            "payload": {"action": wire.get("name")},
        }

    return dispatch


def test_new_commands_validate_and_round_trip():
    for name, payload in COMMANDS:
        command = BrowserCommand({**BASE, "name": name, "payload": payload})
        assert command.name == name
        wire = command.to_wire()
        assert wire["name"] == name
        assert BrowserCommand(wire).name == name


def test_real_client_dispatches_new_commands():
    seen: list[dict] = []
    client = BrowserRealClient(dispatch=_dispatch_recorder(seen))
    for name, payload in COMMANDS:
        event = client.send(BrowserCommand({**BASE, "name": name, "payload": payload}))
        assert event.name == "action.done"
        assert event.payload["action"] == name
    assert [w["name"] for w in seen] == [name for name, _ in COMMANDS]

from __future__ import annotations

import json
from pathlib import Path

import pytest

from handoffkit.cli import main


def test_csp_doctor(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["csp", "doctor"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["protocol"] == "HK-CSP"
    assert data["transports"]["in_process"] is True
    assert data["transports"]["distributed"] is False


def test_csp_demo(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["csp", "demo"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["success"] is True
    assert data["received"] == ["preserve structured context"]


@pytest.mark.monorepo
def test_csp_inspect(capsys: pytest.CaptureFixture[str]) -> None:
    fixture = Path(__file__).resolve().parents[4] / "shared/contracts/fixtures/message_envelope.json"
    assert main(["csp", "inspect", str(fixture)]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["protocol_version"] == "1.0"
    assert data["message_id"] == "msg-0001"

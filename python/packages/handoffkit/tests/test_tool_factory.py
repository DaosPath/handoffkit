from __future__ import annotations

import json
from typing import Any

from handoffkit import ToolFactory, ToolSpec


def test_tool_spec_schema_and_json() -> None:
    spec = ToolSpec(
        name="lookup",
        description="Lookup evidence.",
        parameters={"query": {"type": "string"}},
        required=["query"],
    )
    schema = spec.to_schema()
    assert schema["name"] == "lookup"
    assert schema["parameters"]["required"] == ["query"]
    assert json.loads(spec.to_json())["name"] == "lookup"


def test_tool_factory_from_spec_runs_handler() -> None:
    spec = ToolSpec(
        name="double",
        description="Double an integer.",
        parameters={"value": {"type": "integer"}},
        required=["value"],
    )

    def handler(value: int) -> int:
        return value * 2

    wrapped = ToolFactory.from_spec(spec, handler)
    assert wrapped.name == "double"
    assert wrapped.run(value=3) == 6
    assert wrapped.to_schema()["parameters"]["properties"]["value"]["type"] == "integer"


def test_http_json_tool_uses_selector(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    captured: dict[str, Any] = {}

    class FakeResponse:
        def __enter__(self) -> FakeResponse:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def read(self) -> bytes:
            return b'{"data":[{"id":"1"}]}'

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        captured["url"] = request.full_url
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    spec = ToolSpec(
        name="http_lookup",
        description="HTTP lookup.",
        parameters={"query": {"type": "string"}},
        required=["query"],
    )
    wrapped = ToolFactory.http_json(
        spec,
        url="https://example.test/search",
        query_params={"query": "q"},
        timeout=7,
        result_selector=lambda payload: payload["data"],
    )
    assert wrapped.run(query="asthma") == [{"id": "1"}]
    assert captured["url"] == "https://example.test/search?q=asthma"
    assert captured["timeout"] == 7

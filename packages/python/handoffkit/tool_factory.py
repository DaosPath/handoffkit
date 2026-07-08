"""Helpers for creating reusable tools without custom wrapper code."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from handoffkit.tool import Tool

HttpMethod = Literal["GET", "POST"]


def _json_default(value: Any) -> Any:
    return str(value)


@dataclass(frozen=True)
class ToolSpec:
    """Declarative tool definition."""

    name: str
    description: str
    parameters: dict[str, dict[str, Any]]
    required: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_schema(self) -> dict[str, Any]:
        """Return provider-ready JSON schema."""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": self.parameters,
                "required": self.required,
            },
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this spec."""
        return json.dumps(self.to_schema(), ensure_ascii=False, indent=indent)


class DeclarativeTool(Tool):
    """Tool backed by a ToolSpec and callable handler."""

    def __init__(self, spec: ToolSpec, handler: Callable[..., Any]) -> None:
        self.spec = spec
        super().__init__(handler, name=spec.name, description=spec.description)

    def to_schema(self) -> dict[str, Any]:
        """Return schema from the declarative spec."""
        schema = self.spec.to_schema()
        schema.pop("metadata", None)
        return schema

    def to_dict(self) -> dict[str, Any]:
        """Serialize tool metadata."""
        data = super().to_dict()
        data["metadata"] = self.spec.metadata
        return data


class HttpJsonTool(DeclarativeTool):
    """Simple safe HTTP JSON tool.

    It is intentionally small: fixed URL template, explicit query/body mapping,
    JSON responses only, and no secret printing.
    """

    def __init__(
        self,
        spec: ToolSpec,
        *,
        url: str,
        method: HttpMethod = "GET",
        query_params: dict[str, str] | None = None,
        body_params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        timeout: float = 20.0,
        result_selector: Callable[[dict[str, Any]], Any] | None = None,
    ) -> None:
        self.url = url
        self.method = method
        self.query_params = query_params or {}
        self.body_params = body_params or {}
        self.headers = headers or {}
        self.timeout = timeout
        self.result_selector = result_selector
        super().__init__(spec, self._run_http)

    def _run_http(self, **kwargs: Any) -> Any:
        quoted_kwargs = {
            key: urllib.parse.quote(str(value)) for key, value in kwargs.items()
        }
        url = self.url.format(**quoted_kwargs)
        query = {
            target: kwargs[source]
            for source, target in self.query_params.items()
            if source in kwargs and kwargs[source] is not None
        }
        if query:
            separator = "&" if "?" in url else "?"
            url = f"{url}{separator}{urllib.parse.urlencode(query)}"
        data = None
        if self.method == "POST":
            body = {
                target: kwargs[source]
                for source, target in self.body_params.items()
                if source in kwargs and kwargs[source] is not None
            }
            data = json.dumps(body, default=_json_default).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=data,
            method=self.method,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "handoffkit/1.3 ToolFactory",
                **self.headers,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:400]
            raise RuntimeError(f"HTTP {exc.code} from tool endpoint: {detail}") from exc
        if not isinstance(payload, dict):
            raise RuntimeError("HTTP JSON tool expected a JSON object response.")
        if self.result_selector:
            return self.result_selector(payload)
        return payload


class ToolFactory:
    """Factory for declarative and HTTP JSON tools."""

    @staticmethod
    def from_function(
        func: Callable[..., Any],
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> Tool:
        """Create a Tool from a Python function."""
        return Tool(func, name=name, description=description)

    @staticmethod
    def from_spec(spec: ToolSpec, handler: Callable[..., Any]) -> DeclarativeTool:
        """Create a Tool from explicit schema and handler."""
        return DeclarativeTool(spec, handler)

    @staticmethod
    def http_json(
        spec: ToolSpec,
        *,
        url: str,
        method: HttpMethod = "GET",
        query_params: dict[str, str] | None = None,
        body_params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        timeout: float = 20.0,
        result_selector: Callable[[dict[str, Any]], Any] | None = None,
    ) -> HttpJsonTool:
        """Create a safe HTTP JSON tool from a spec."""
        return HttpJsonTool(
            spec,
            url=url,
            method=method,
            query_params=query_params,
            body_params=body_params,
            headers=headers,
            timeout=timeout,
            result_selector=result_selector,
        )

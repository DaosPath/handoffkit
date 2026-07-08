"""Tool decorator and metadata model."""

from __future__ import annotations

import functools
import inspect
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypeVar, get_args, get_origin, get_type_hints

from handoffkit.errors import ToolExecutionError

F = TypeVar("F", bound=Callable[..., Any])


def _type_name(value: Any) -> str:
    """Return a readable name for a type annotation."""
    if value is inspect.Signature.empty:
        return "Any"
    if hasattr(value, "__name__"):
        return value.__name__
    return str(value).replace("typing.", "")


def _json_schema_type(value: Any) -> str:
    """Map a Python annotation to a simple JSON schema type."""
    if value is inspect.Signature.empty or value is Any:
        return "string"

    origin = get_origin(value)
    target = origin or value
    if target is str:
        return "string"
    if target is int:
        return "integer"
    if target is float:
        return "number"
    if target is bool:
        return "boolean"
    if target is list:
        return "array"
    if target is dict:
        return "object"
    return "string"


def _json_schema_for_annotation(value: Any) -> dict[str, Any]:
    """Return a compact JSON-schema-like object for one annotation."""
    schema: dict[str, Any] = {"type": _json_schema_type(value)}
    origin = get_origin(value)
    args = get_args(value)
    if (origin is list or value is list) and args:
        schema["items"] = _json_schema_for_annotation(args[0])
    if origin is dict and len(args) == 2:
        schema["additionalProperties"] = _json_schema_for_annotation(args[1])
    return schema


@dataclass(frozen=True)
class ToolParameter:
    """Metadata about one tool parameter."""

    name: str
    annotation: str
    required: bool
    default: Any = None


class Tool:
    """Executable wrapper around a Python function."""

    def __init__(
        self,
        func: Callable[..., Any],
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> None:
        if not callable(func):
            raise TypeError("Tool requires a callable.")
        functools.update_wrapper(self, func)
        self.func = func
        self.name = name or func.__name__
        self.description = description or inspect.getdoc(func) or ""
        self.signature = inspect.signature(func)
        self.type_hints = get_type_hints(func)
        self.parameters = self._build_parameters()
        self.return_type = _type_name(
            self.type_hints.get("return", self.signature.return_annotation)
        )

    def _build_parameters(self) -> dict[str, ToolParameter]:
        parameters: dict[str, ToolParameter] = {}
        for name, parameter in self.signature.parameters.items():
            annotation = self.type_hints.get(name, parameter.annotation)
            required = parameter.default is inspect.Signature.empty
            default = None if required else parameter.default
            parameters[name] = ToolParameter(
                name=name,
                annotation=_type_name(annotation),
                required=required,
                default=default,
            )
        return parameters

    @property
    def original_function(self) -> Callable[..., Any]:
        """Return the wrapped Python function."""
        return self.func

    def to_dict(self) -> dict[str, Any]:
        """Serialize tool metadata to a dictionary."""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                name: {
                    "type": parameter.annotation,
                    "required": parameter.required,
                    "default": parameter.default,
                }
                for name, parameter in self.parameters.items()
            },
            "return_type": self.return_type,
        }

    def to_schema(self) -> dict[str, Any]:
        """Return a simple JSON-schema-compatible tool description."""
        properties: dict[str, Any] = {}
        required: list[str] = []
        for name, parameter in self.signature.parameters.items():
            annotation = self.type_hints.get(name, parameter.annotation)
            properties[name] = _json_schema_for_annotation(annotation)
            if parameter.default is inspect.Signature.empty:
                required.append(name)
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        }

    def run(self, **kwargs: Any) -> Any:
        """Run the wrapped function with keyword arguments."""
        try:
            bound = self.signature.bind(**kwargs)
            bound.apply_defaults()
            return self.func(*bound.args, **bound.kwargs)
        except TypeError:
            raise
        except Exception as exc:
            if exc.__class__.__module__.startswith("handoffkit"):
                raise
            raise ToolExecutionError(f"Tool {self.name!r} failed: {exc}") from exc

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        """Call the tool like the original function."""
        if args:
            bound = self.signature.bind(*args, **kwargs)
            bound.apply_defaults()
            return self.func(*bound.args, **bound.kwargs)
        return self.run(**kwargs)

    def __repr__(self) -> str:
        return f"Tool(name={self.name!r})"


def tool(
    func: F | None = None,
    *,
    name: str | None = None,
    description: str | None = None,
) -> Tool | Callable[[F], Tool]:
    """Convert a function into an executable Tool.

    Can be used as `@tool` or `@tool(name="custom_name")`.
    """

    def decorator(inner: F) -> Tool:
        return Tool(inner, name=name, description=description)

    if func is None:
        return decorator
    return decorator(func)


def ensure_tool(candidate: Tool | Callable[..., Any]) -> Tool:
    """Return a Tool instance for a Tool or callable."""
    if isinstance(candidate, Tool):
        return candidate
    if callable(candidate):
        return Tool(candidate)
    raise TypeError(f"Expected Tool or callable, got {type(candidate).__name__}.")

"""Safe extension registry for recipes and tools."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from handoffkit.recipes import Recipe
from handoffkit.tool import Tool, ensure_tool


def _json_default(value: Any) -> Any:
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return str(value)


@dataclass
class Extension:
    """A safe bundle of recipes and tools."""

    name: str
    description: str
    version: str
    recipes: list[Recipe] = field(default_factory=list)
    tools: list[Tool | Callable[..., Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def validate(self) -> Extension:
        """Validate this extension."""
        if not self.name.strip():
            raise ValueError("extension name must be a non-empty string")
        for recipe in self.recipes:
            recipe.validate()
        tool_names = [ensure_tool(item).name for item in self.tools]
        duplicates = sorted({name for name in tool_names if tool_names.count(name) > 1})
        if duplicates:
            raise ValueError(f"duplicate tool names: {', '.join(duplicates)}")
        return self

    def to_dict(self) -> dict[str, Any]:
        """Serialize this extension."""
        return {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "recipes": [recipe.to_dict() for recipe in self.recipes],
            "tools": [ensure_tool(item).to_dict() for item in self.tools],
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this extension as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)


class ExtensionRegistry:
    """In-memory registry for safe extensions."""

    def __init__(self) -> None:
        self._extensions: dict[str, Extension] = {}

    def register(self, extension: Extension) -> Extension:
        """Register one extension by name."""
        extension.validate()
        if extension.name in self._extensions:
            raise ValueError(f"Extension already registered: {extension.name}")
        self._extensions[extension.name] = extension
        return extension

    def get(self, name: str) -> Extension:
        """Get one extension by name."""
        try:
            return self._extensions[name]
        except KeyError as exc:
            raise KeyError(f"Extension not found: {name}") from exc

    def list(self) -> list[Extension]:
        """List registered extensions."""
        return [self._extensions[name] for name in sorted(self._extensions)]

    def recipes(self) -> list[Recipe]:
        """Return recipes from all registered extensions."""
        items: list[Recipe] = []
        for extension in self.list():
            items.extend(extension.recipes)
        return items

    def tools(self) -> list[Tool]:
        """Return tools from all registered extensions."""
        items: list[Tool] = []
        for extension in self.list():
            items.extend(ensure_tool(tool) for tool in extension.tools)
        return items

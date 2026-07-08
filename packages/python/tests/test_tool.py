from handoffkit import tool


@tool
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b


def test_tool_metadata() -> None:
    assert add.name == "add"
    assert add.description == "Add two numbers."
    assert add.parameters["a"].annotation == "int"
    assert add.parameters["b"].required is True


def test_tool_run() -> None:
    assert add.run(a=2, b=3) == 5
    assert add(4, 5) == 9


def test_tool_to_schema_for_required_integer_parameters() -> None:
    assert add.to_schema() == {
        "name": "add",
        "description": "Add two numbers.",
        "parameters": {
            "type": "object",
            "properties": {
                "a": {"type": "integer"},
                "b": {"type": "integer"},
            },
            "required": ["a", "b"],
        },
    }


def test_tool_to_schema_supports_common_builtin_types() -> None:
    @tool
    def configure(
        name: str,
        retries: int,
        threshold: float,
        enabled: bool,
        tags: list[str],
        metadata: dict[str, int],
        optional_note: str = "none",
    ) -> dict[str, str]:
        """Configure a workflow."""
        return {"name": name, "note": optional_note}

    schema = configure.to_schema()
    properties = schema["parameters"]["properties"]

    assert properties["name"] == {"type": "string"}
    assert properties["retries"] == {"type": "integer"}
    assert properties["threshold"] == {"type": "number"}
    assert properties["enabled"] == {"type": "boolean"}
    assert properties["tags"] == {"type": "array", "items": {"type": "string"}}
    assert properties["metadata"] == {
        "type": "object",
        "additionalProperties": {"type": "integer"},
    }
    assert schema["parameters"]["required"] == [
        "name",
        "retries",
        "threshold",
        "enabled",
        "tags",
        "metadata",
    ]

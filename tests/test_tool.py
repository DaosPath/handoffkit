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

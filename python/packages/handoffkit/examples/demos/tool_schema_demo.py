"""Show JSON-schema-style metadata for a HandoffKit tool."""

from handoffkit import tool


@tool
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b


def main() -> None:
    """Print the tool schema and execute the tool."""
    print(add.to_schema())
    print(add.run(a=2, b=3))


if __name__ == "__main__":
    main()

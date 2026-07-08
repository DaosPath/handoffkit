"""Agent with a custom tool."""

from handoffkit import Agent, tool


@tool
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b


agent = Agent(
    name="Calculator",
    role="Use tools to solve arithmetic.",
    tools=[add],
)

print(add.run(a=2, b=3))
print(agent.describe())

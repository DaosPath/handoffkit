"""Basic EchoProvider agent example."""

from handoffkit import Agent


agent = Agent(
    name="Planner",
    role="You create technical plans.",
)

print(agent.run("Create a plan for a Python CLI app."))

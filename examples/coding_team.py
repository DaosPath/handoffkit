"""Sequential coding team demo."""

from handoffkit import Agent, HandoffProtocol, Team


architect = Agent("Architect", "Create implementation plans.")
coder = Agent("Coder", "Implement code based on handoff state.")
tester = Agent("Tester", "Test implementation and report errors.")

team = Team(
    agents=[architect, coder, tester],
    protocol=HandoffProtocol(mode="hybrid_state"),
)

result = team.run("Create a small Python CLI calculator with tests.")
print(result)

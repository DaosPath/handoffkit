def test_backward_compatible_public_imports() -> None:
    from handoffkit import Agent, HandoffProtocol, Team, tool

    assert Agent.__name__ == "Agent"
    assert HandoffProtocol.__name__ == "HandoffProtocol"
    assert Team.__name__ == "Team"
    assert callable(tool)

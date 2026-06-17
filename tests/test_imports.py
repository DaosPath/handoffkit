def test_backward_compatible_public_imports() -> None:
    from handoffkit import (
        Agent,
        ContextPack,
        ContextRetriever,
        HandoffProtocol,
        JsonMemoryStore,
        MemoryItem,
        MemoryStore,
        ProjectIndexer,
        Team,
        tool,
    )

    assert Agent.__name__ == "Agent"
    assert HandoffProtocol.__name__ == "HandoffProtocol"
    assert Team.__name__ == "Team"
    assert MemoryItem.__name__ == "MemoryItem"
    assert MemoryStore.__name__ == "MemoryStore"
    assert JsonMemoryStore.__name__ == "JsonMemoryStore"
    assert ProjectIndexer.__name__ == "ProjectIndexer"
    assert ContextRetriever.__name__ == "ContextRetriever"
    assert ContextPack.__name__ == "ContextPack"
    assert callable(tool)

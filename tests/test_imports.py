def test_backward_compatible_public_imports() -> None:
    from handoffkit import (
        Agent,
        ContextPack,
        ContextRetriever,
        Extension,
        ExtensionRegistry,
        HandoffProtocol,
        JsonMemoryStore,
        MemoryItem,
        MemoryStore,
        ProjectIndexer,
        Recipe,
        RecipeRunner,
        RecipeRunResult,
        RecipeStep,
        Team,
        ToolCall,
        ToolRegistry,
        ToolResult,
        WorkflowTemplate,
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
    assert RecipeStep.__name__ == "RecipeStep"
    assert Recipe.__name__ == "Recipe"
    assert RecipeRunner.__name__ == "RecipeRunner"
    assert RecipeRunResult.__name__ == "RecipeRunResult"
    assert WorkflowTemplate.__name__ == "WorkflowTemplate"
    assert Extension.__name__ == "Extension"
    assert ExtensionRegistry.__name__ == "ExtensionRegistry"
    assert ToolCall.__name__ == "ToolCall"
    assert ToolResult.__name__ == "ToolResult"
    assert ToolRegistry.__name__ == "ToolRegistry"
    assert callable(tool)

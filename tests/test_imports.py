def test_backward_compatible_public_imports() -> None:
    from handoffkit import (
        Agent,
        ContextPack,
        ContextRetriever,
        Extension,
        ExtensionRegistry,
        HandoffProtocol,
        JsonMemoryStore,
        JsonOutputParser,
        MemoryItem,
        MemoryStore,
        OutputRepairer,
        ProjectIndexer,
        ProviderCapabilities,
        ProviderToolAdapter,
        Recipe,
        RecipeRunner,
        RecipeRunResult,
        RecipeStep,
        StructuredOutputResult,
        StructuredOutputSchema,
        Team,
        ToolCall,
        ToolCallParser,
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
    assert StructuredOutputSchema.__name__ == "StructuredOutputSchema"
    assert StructuredOutputResult.__name__ == "StructuredOutputResult"
    assert JsonOutputParser.__name__ == "JsonOutputParser"
    assert OutputRepairer.__name__ == "OutputRepairer"
    assert ProviderCapabilities.__name__ == "ProviderCapabilities"
    assert ProviderToolAdapter.__name__ == "ProviderToolAdapter"
    assert ToolCallParser.__name__ == "ToolCallParser"
    assert ToolCall.__name__ == "ToolCall"
    assert ToolResult.__name__ == "ToolResult"
    assert ToolRegistry.__name__ == "ToolRegistry"
    assert callable(tool)

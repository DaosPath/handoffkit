def test_backward_compatible_public_imports() -> None:
    from handoffkit import (
        Agent,
        ContextPack,
        ContextRetriever,
        Extension,
        ExtensionRegistry,
        HandoffProtocol,
        HandoffQualityEvaluator,
        HandoffQualityMetric,
        HandoffQualityReport,
        HandoffStateValidator,
        JsonMemoryStore,
        JsonOutputParser,
        MemoryItem,
        MemoryStore,
        OutputRepairer,
        ProjectIndexer,
        ProviderCapabilities,
        ProviderToolAdapter,
        ProviderToolFormat,
        Recipe,
        RecipeRunner,
        RecipeRunResult,
        RecipeStep,
        StructuredOutputResult,
        StructuredOutputSchema,
        StructuredOutputValidator,
        Team,
        ToolCall,
        ToolCallParser,
        ToolRegistry,
        ToolResult,
        ToolSchemaValidator,
        ValidationIssue,
        ValidationReport,
        WorkflowTemplate,
        tool,
    )

    assert Agent.__name__ == "Agent"
    assert HandoffProtocol.__name__ == "HandoffProtocol"
    assert HandoffQualityMetric.__name__ == "HandoffQualityMetric"
    assert HandoffQualityReport.__name__ == "HandoffQualityReport"
    assert HandoffQualityEvaluator.__name__ == "HandoffQualityEvaluator"
    assert HandoffStateValidator.__name__ == "HandoffStateValidator"
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
    assert ProviderToolFormat is not None
    assert ToolCallParser.__name__ == "ToolCallParser"
    assert ToolCall.__name__ == "ToolCall"
    assert ToolResult.__name__ == "ToolResult"
    assert ToolRegistry.__name__ == "ToolRegistry"
    assert StructuredOutputValidator.__name__ == "StructuredOutputValidator"
    assert ToolSchemaValidator.__name__ == "ToolSchemaValidator"
    assert ValidationIssue.__name__ == "ValidationIssue"
    assert ValidationReport.__name__ == "ValidationReport"
    assert callable(tool)

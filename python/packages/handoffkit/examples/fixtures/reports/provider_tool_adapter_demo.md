# Provider Tool Adapter Demo

## Tool Calls

label

## Result

label:provider-adapter

## Report

```json
{
  "provider_tools": [
    {
      "name": "label",
      "description": "Return a labeled value.",
      "parameters": {
        "type": "object",
        "properties": {
          "value": {
            "type": "string"
          }
        },
        "required": [
          "value"
        ]
      }
    }
  ],
  "tool_calls": [
    {
      "tool_name": "label",
      "arguments": {
        "value": "provider-adapter"
      },
      "call_id": "call_provider_adapter_demo",
      "metadata": {
        "provider_format": "openai"
      }
    }
  ],
  "tool_results": [
    {
      "tool_name": "label",
      "success": true,
      "result": "label:provider-adapter",
      "error": null,
      "call_id": "call_provider_adapter_demo",
      "metadata": {}
    }
  ],
  "capabilities": {
    "supports_structured_output": false,
    "supports_tool_calling": true,
    "supports_json_mode": true,
    "supports_streaming": false,
    "metadata": {},
    "provider": "",
    "tool_format": "handoffkit",
    "supports_parallel_tool_calls": false,
    "strict_json_schema": false
  }
}
```

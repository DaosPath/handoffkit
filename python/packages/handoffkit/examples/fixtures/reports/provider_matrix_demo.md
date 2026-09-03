# Report

```json
{
  "success": true,
  "formats": [
    "handoffkit",
    "openai",
    "anthropic"
  ],
  "matrix": {
    "handoffkit": {
      "adapter": {
        "provider_format": "handoffkit",
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
      },
      "tools": [
        {
          "name": "add",
          "description": "Add two integers.",
          "parameters": {
            "type": "object",
            "properties": {
              "a": {
                "type": "integer"
              },
              "b": {
                "type": "integer"
              }
            },
            "required": [
              "a",
              "b"
            ]
          }
        }
      ]
    },
    "openai": {
      "adapter": {
        "provider_format": "openai",
        "capabilities": {
          "supports_structured_output": false,
          "supports_tool_calling": true,
          "supports_json_mode": true,
          "supports_streaming": false,
          "metadata": {},
          "provider": "",
          "tool_format": "openai",
          "supports_parallel_tool_calls": false,
          "strict_json_schema": false
        }
      },
      "tools": [
        {
          "type": "function",
          "function": {
            "name": "add",
            "description": "Add two integers.",
            "parameters": {
              "type": "object",
              "properties": {
                "a": {
                  "type": "integer"
                },
                "b": {
                  "type": "integer"
                }
              },
              "required": [
                "a",
                "b"
              ]
            }
          }
        }
      ]
    },
    "anthropic": {
      "adapter": {
        "provider_format": "anthropic",
        "capabilities": {
          "supports_structured_output": false,
          "supports_tool_calling": true,
          "supports_json_mode": true,
          "supports_streaming": false,
          "metadata": {},
          "provider": "",
          "tool_format": "anthropic",
          "supports_parallel_tool_calls": false,
          "strict_json_schema": false
        }
      },
      "tools": [
        {
          "name": "add",
          "description": "Add two integers.",
          "input_schema": {
            "type": "object",
            "properties": {
              "a": {
                "type": "integer"
              },
              "b": {
                "type": "integer"
              }
            },
            "required": [
              "a",
              "b"
            ]
          }
        }
      ]
    }
  }
}
```

# Provider Tool Formats Demo

## Formats

- handoffkit tools: 1
- openai tools: 1
- anthropic tools: 1

## Parsed Calls

```json
{
  "openai": [
    {
      "tool_name": "add",
      "arguments": {
        "a": 2,
        "b": 3
      },
      "call_id": "call_openai_1",
      "metadata": {
        "provider_format": "openai"
      }
    }
  ],
  "anthropic": [
    {
      "tool_name": "add",
      "arguments": {
        "a": 5,
        "b": 8
      },
      "call_id": "toolu_1",
      "metadata": {
        "provider_format": "anthropic"
      }
    }
  ]
}
```

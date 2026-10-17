# GetDynamicTools  (S1, first seen in request 47, call_id call_c0bf22d037314bddbd26737d3c2c1898, item type function_call)

## Arguments

```
{"namespace":"cursor","toolName":"Delete"}
```

## Output

```
{
  "tool": "Delete",
  "description": "Delete file at specified path relative to workspace root; fails gracefully if file doesn't exist, security rejection, or undeletable.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "The absolute path of the file to delete"
      }
    },
    "required": [
      "path"
    ]
  }
}
```

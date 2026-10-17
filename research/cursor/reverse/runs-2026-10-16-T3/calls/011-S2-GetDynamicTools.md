# GetDynamicTools  (S2, first seen in request 13, call_id call_a95d7baf26c64909ade7038a430ddc1f, item type function_call)

## Arguments

```
{"pattern":"[Pp]lan|CreateGoal"}
```

## Output

```
{
  "mode": "search",
  "pattern": "[Pp]lan|CreateGoal",
  "matches": [
    {
      "namespace": "cursor",
      "tool": "CreateGoal",
      "description": "Create a long-running goal. Only use this tool when explicitly requested by the user; NEVER use this tool for ordinary tasks."
    }
  ]
}
```

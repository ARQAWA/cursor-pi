ARGS:
{"namespace":"cursor-origin","toolName":"list_repositories"}

OUTPUT:
[
 {
  "text": "{\n  \"tool\": \"list_repositories\",\n  \"description\": \"List Origin repositories belonging to an owner slug.\",\n  \"inputSchema\": {\n    \"type\": \"object\",\n    \"properties\": {\n      \"owner\": {\n        \"type\": \"string\",\n        \"description\": \"Origin namespace (owner) slug, taken from list_namespaces or an earlier Origin result. A GitHub owner or org name is not an Origin namespace unless list_namespaces returns it.\"\n      },\n      \"pageSize\": {\n        \"type\": \"number\"\n      },\n      \"pageToken\": {\n        \"type\": \"string\"\n      },\n      \"filter\": {\n        \"type\": \"string\",\n        \"description\": \"Case-insensitive repository name substring\"\n      }\n    },\n    \"required\": [\n      \"owner\"\n    ],\n    \"additionalProperties\": false,\n    \"$schema\": \"http://json-schema.org/draft-07/schema#\"\n  }\n}",
  "type": "input_text"
 }
]
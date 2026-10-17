ARGS:
{"namespace":"cursor-origin","toolName":"get_repository"}

OUTPUT:
[
 {
  "text": "{\n  \"tool\": \"get_repository\",\n  \"description\": \"Get one Origin repository by owner and name, including default branch, mirror state, visibility, and merge settings.\",\n  \"inputSchema\": {\n    \"type\": \"object\",\n    \"properties\": {\n      \"owner\": {\n        \"type\": \"string\",\n        \"description\": \"Origin namespace (owner) slug, taken from list_namespaces or an earlier Origin result. A GitHub owner or org name is not an Origin namespace unless list_namespaces returns it.\"\n      },\n      \"name\": {\n        \"type\": \"string\",\n        \"description\": \"Origin repository name within that namespace\"\n      }\n    },\n    \"required\": [\n      \"owner\",\n      \"name\"\n    ],\n    \"additionalProperties\": false,\n    \"$schema\": \"http://json-schema.org/draft-07/schema#\"\n  }\n}",
  "type": "input_text"
 }
]
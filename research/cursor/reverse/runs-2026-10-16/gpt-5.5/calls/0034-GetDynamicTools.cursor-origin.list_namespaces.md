ARGS:
{"namespace":"cursor-origin","toolName":"list_namespaces"}

OUTPUT:
[
 {
  "text": "{\n  \"tool\": \"list_namespaces\",\n  \"description\": \"List the Origin namespaces (owner slugs) the caller can list repositories in, ordered by slug. Each slug is a valid owner for list_repositories; viewerCanCreateRepositories reports whether creating a repository there would be allowed. An empty list means the caller has no Origin repositories to read; repositories on GitHub or other hosts are not reachable through these tools.\",\n  \"inputSchema\": {\n    \"type\": \"object\",\n    \"properties\": {\n      \"pageSize\": {\n        \"type\": \"number\"\n      },\n      \"pageToken\": {\n        \"type\": \"string\"\n      }\n    },\n    \"additionalProperties\": false,\n    \"$schema\": \"http://json-schema.org/draft-07/schema#\"\n  }\n}",
  "type": "input_text"
 }
]
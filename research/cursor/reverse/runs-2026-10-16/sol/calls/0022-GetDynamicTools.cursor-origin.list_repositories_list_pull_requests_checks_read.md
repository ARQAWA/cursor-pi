ARGS:
{"namespace":"cursor-origin","pattern":"list_repositories|list_pull_requests|checks_read"}

OUTPUT:
[
 {
  "text": "{\n  \"mode\": \"search\",\n  \"pattern\": \"list_repositories|list_pull_requests|checks_read\",\n  \"matches\": [\n    {\n      \"namespace\": \"cursor-origin\",\n      \"tool\": \"checks_read\",\n      \"description\": \"Read checks for one target in an Origin-hosted repository: a pull request, commit, suite, or run. A top-level ref, sha, or pull number is accepted in place of target. Rollup covers mate... [truncated]\"\n    },\n    {\n      \"namespace\": \"cursor-origin\",\n      \"tool\": \"list_pull_requests\",\n      \"description\": \"List pull requests in an Origin-hosted repository, filtered by state, head, author, base, or stackId and sorted by creation or update time in either direction. Items are compact summari... [truncated]\"\n    },\n    {\n      \"namespace\": \"cursor-origin\",\n      \"tool\": \"list_repositories\",\n      \"description\": \"List Origin repositories belonging to an owner slug.\"\n    }\n  ]\n}",
  "type": "input_text"
 }
]
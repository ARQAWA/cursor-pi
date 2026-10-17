ARGS:
{"command":"gh repo list --limit 1000 --json name,nameWithOwner,url --jq '.[] | select(.name == \"superbot-test-Gd9Ld3YH\")'","description":"Репозиторий в аккаунте GitHub","working_directory":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH","block_until_ms":30000}

OUTPUT:
[
 {
  "text": "Exit code: 0\n\nCommand output:\n\n```\n\n```\n\nCommand completed in 2453 ms.\n\nShell state (cwd, env vars) persists for subsequent calls. Current directory: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH",
  "type": "input_text"
 }
]
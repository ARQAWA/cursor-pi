ARGS:
{"command":"sha=$(git rev-parse HEAD) && gh api -X GET search/commits -f q=\"$sha\" --jq '.items[] | {repository: .repository.full_name, url: .html_url}'","description":"Репозиторий по коммиту","working_directory":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH","block_until_ms":30000}

OUTPUT:
[
 {
  "text": "Exit code: 0\n\nCommand output:\n\n```\n\n```\n\nCommand completed in 1999 ms.\n\nShell state (cwd, env vars) persists for subsequent calls. Current directory: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH",
  "type": "input_text"
 }
]
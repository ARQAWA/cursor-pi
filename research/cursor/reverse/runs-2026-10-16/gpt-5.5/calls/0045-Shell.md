ARGS:
{"command":"gh repo list ARQAWA --limit 1000 --json name,nameWithOwner,url,isFork --source | jq '[.[] | select((.name | ascii_downcase) == \"superbot-test-gd9ld3yh\")]'","working_directory":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH","block_until_ms":30000,"description":"Search account repositories by project name"}

OUTPUT:
[
 {
  "text": "Exit code: 0\n\nCommand output:\n\n```\n[]\n\n```\n\nCommand completed in 2251 ms.\n\nShell state (cwd, env vars) persists for subsequent calls. Current directory: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH",
  "type": "input_text"
 }
]
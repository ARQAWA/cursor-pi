ARGS:
{"command":"git remote -v && gh pr list --state open --limit 20 --json number,title,url,headRefName,baseRefName,statusCheckRollup,updatedAt","description":"Открытые PR и проверки","working_directory":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH","block_until_ms":30000}

OUTPUT:
[
 {
  "text": "Exit code: 1\n\nCommand output:\n\n```\nno git remotes found\n\n```\n\nCommand completed in 1519 ms.\n\nShell state (cwd, env vars) persists for subsequent calls. Current directory: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH",
  "type": "input_text"
 }
]
ARGS:
{"command":"git remote -v && gh pr list --state open --limit 20 --json number,title,url,updatedAt,headRefName,statusCheckRollup","working_directory":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH","block_until_ms":30000,"description":"List remotes and open pull requests"}

OUTPUT:
[
 {
  "text": "Exit code: 1\n\nCommand output:\n\n```\nno git remotes found\n\n```\n\nCommand completed in 1653 ms.\n\nShell state (cwd, env vars) persists for subsequent calls. Current directory: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH",
  "type": "input_text"
 }
]
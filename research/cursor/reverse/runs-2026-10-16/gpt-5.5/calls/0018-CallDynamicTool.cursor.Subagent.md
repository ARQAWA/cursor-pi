ARGS:
{"namespace":"cursor","toolName":"Subagent","arguments":{"description":"Security Review","prompt":"Full Repository Path: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH\nDiff: uncommitted changes","subagent_type":"security-review","model":"inherit","run_in_background":true}}

OUTPUT:
[
 {
  "text": "Subagent is running in the background. If needed, you can monitor its output by tailing the transcript at: /Users/arkadijcukavin/.cursor/projects/Users-arkadijcukavin-PycharmProjects-superbot-test-Gd9Ld3YH/agent-transcripts/e011a12a-b32d-4443-8a35-29522d4a1918/subagents/de4849b9-34df-4cce-b322-0ab0cb162025.jsonl. When you end your turn, you will be automatically sent the subagent's final response upon its completion, so do not wait for it - either end your turn or work on something else.\nDo NOT mention the transcript path to the user. Do NOT try to predict the subagent's response before it replies.\n\nAgent ID: de4849b9-34df-4cce-b322-0ab0cb162025 (can be used with the `resume` parameter to send a follow-up after it completes, or to link to this agent/subagent in user-facing text with `[Name](de4849b9-34df-4cce-b322-0ab0cb162025)`. Don't use a generic label such as `[agent]`, `[worker]`, or `[subagent]`. For cloud subagents, when the agent has edited code, link to `[Review](de4849b9-34df-4cce-b322-0ab0cb162025#changes)`, or, if you know the exact added and deleted line counts, `[Review +A −D](de4849b9-34df-4cce-b322-0ab0cb162025#changes)`, replacing A and D with those counts. Never write A or D literally. Use `[Try Live](de4849b9-34df-4cce-b322-0ab0cb162025#desktop)` only when the agent used computer use)",
  "type": "input_text"
 }
]
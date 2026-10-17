ARGS:
{"namespace":"cursor","toolName":"Subagent","arguments":{"description":"Краткое определение Ask","prompt":"Новое короткое задание вместо предыдущего: верни только одно предложение, определяющее Ask mode. Больше ничего не проверяй.","resume":"2bf78b8a-868e-487c-bce5-f95ac45757fa","interrupt":true,"run_in_background":true}}

OUTPUT:
[
 {
  "text": "Subagent is running in the background. If needed, you can monitor its output by tailing the transcript at: /Users/arkadijcukavin/.cursor/projects/Users-arkadijcukavin-PycharmProjects-superbot-test-Gd9Ld3YH/agent-transcripts/6c6c0e1a-4cbb-4d18-b157-6a643216b286/subagents/2bf78b8a-868e-487c-bce5-f95ac45757fa.jsonl. When you end your turn, you will be automatically sent the subagent's final response upon its completion, so do not wait for it - either end your turn or work on something else.\nDo NOT mention the transcript path to the user. Do NOT try to predict the subagent's response before it replies.\n\nAgent ID: 2bf78b8a-868e-487c-bce5-f95ac45757fa (can be used with the `resume` parameter to send a follow-up after it completes, or to link to this agent/subagent in user-facing text with `[Name](2bf78b8a-868e-487c-bce5-f95ac45757fa)`. Don't use a generic label such as `[agent]`, `[worker]`, or `[subagent]`. For cloud subagents, when the agent has edited code, link to `[Review](2bf78b8a-868e-487c-bce5-f95ac45757fa#changes)`, or, if you know the exact added and deleted line counts, `[Review +A −D](2bf78b8a-868e-487c-bce5-f95ac45757fa#changes)`, replacing A and D with those counts. Never write A or D literally. Use `[Try Live](2bf78b8a-868e-487c-bce5-f95ac45757fa#desktop)` only when the agent used computer use)",
  "type": "input_text"
 }
]
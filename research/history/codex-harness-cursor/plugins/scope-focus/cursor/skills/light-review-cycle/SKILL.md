---
name: light-review-cycle
description: Run only when explicitly invoked for one fresh blind CLEAN pass with Spotty (gpt-6.1-sol / low) and an autonomous batch-fix loop.
disable-model-invocation: true
---

# Light Review Cycle

Use only on explicit invocation. Select `subagent_type=spotty` (`gpt-6.1-sol`,
reasoning `low`) and one clean pass per checkpoint.

Read and follow the [shared blind contract](../blind-review-cycle/SKILL.md),
including target selection, `review_stage` (`pre-action` or `pre-completion`),
the frozen object and packet, fresh read-only reviewers, finding admission,
and batch repair. Preserve Spotty and the single-pass requirement after repairs.
Reading the shared contract does not select Smarty or start a Blind cycle.

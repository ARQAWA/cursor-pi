# OMP history coverage snapshot and completed research

## Scope and completeness of source inventory

Main obtained archive.projects({limit:500}) and archive.sessions({project:'*', limit:500}) after completing the Sol prompt analysis. There are 24 project entries and 405 returned nonempty sessions, dated 2026-10-04T10:11:43.094Z through 2026-10-17T06:35:05.760Z. Project counts total 417 raw session files.

Main independently enumerated /Users/arkadijcukavin/.omp/agent/sessions one project-directory level and found exactly 417 top-level session JSONL files. Comparing paths to the 405-session archive snapshot leaves 12 files. Main read and parsed all 12; each contains zero records with message.role=user or role=user. Eleven have 4 metadata records and one has 6. These are empty sessions, not missing owner statements. No indexed nonempty session was omitted from the partitions.

## All partitions completed on the requested model

All three were launched through task agent=custom, model=anthropic/claude-sonnet-5-5, effort=xhigh. No model fallback or substitution was reported.

| Partition | Sessions parsed | User-role records examined | Access/JSON errors | Evidence notes |
| --- | ---: | ---: | ---: | --- |
| Main harness, created before 2026-10-11 | 98/98 | 762 | 0 | local://history-early-findings.md; local://history-early-quotes.md; local://history-early-episodes.md; local://history-early-coverage.md |
| Main harness, created on/after 2026-10-11 | 37/37 | 511 | 0 | local://history-late-findings.md |
| All other projects | 270/270 | 1153 | 0 | local://history-other-findings.md |
| Total | 405/405 | 2426 | 0 | all assigned sessions represented |

Disjoint input partitions: local://omp-history-early.jsonl (98), local://omp-history-late.jsonl (37), local://omp-history-other.jsonl (270). Full top-level index: local://omp-workflow-session-inventory.jsonl.

Method: every assigned JSONL file parsed; user-message texts inspected across all files, not just title/keyword matches; broad multi-phrasing thematic search; neighbouring replies/tool actions read for relevant episodes; repeated copied messages, synthetic benchmark/install probes and injected instructions classified separately; chronological corrections and contrary cases retained. In the other-project partition 151 sessions are benchmark/probe runs and 47 of the other 119 lack substantive owner-workflow content. They were inspected, not counted as independent preference evidence. Early partition separates 695 owner messages, 12 ToSpec launch messages and 55 synthetic messages. Late partition separates 504 non-synthetic owner-role turns and 7 synthetic probes, plus 9 owner collab prompts read separately. Counts are raw records, not 2426 distinct independent preferences; forks and copied messages repeat content.

## Material limitations

The source history is local OMP history on this host. No claim is made about deleted sessions, other machines or unavailable history before 2026-10-04. The current session is a snapshot and is not independent historical validation of its own request. Nested subagent transcripts are contextual evidence where an owner-request episode requires them, not independent owner preferences or a demand to audit all generated subagent chatter. Tool-result bodies and agent outputs were read selectively for relevant episodes; this is not an exhaustive read of every tool result or an audit of the codebases discussed. The owner supplied some pasted conversations; only his attributable words are used, and their original external conversations were not independently inspected. Some messages are dictated; actor/reference ambiguity remains explicit where not settled by context. Completeness of file/message coverage does not prove perfect semantic recall.

No candidate prompt was installed or benchmarked. Historical main-model names do not establish which system-prompt revision was used in every session, and no causal performance comparison is claimed. The research supports owner preferences, observed failure patterns and a rationale for proposed wording, not measured speed gains or a guarantee against future context loss.

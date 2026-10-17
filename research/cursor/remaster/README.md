# Remaster foundation

The remaster is a clone of Cursor on omp. The evidence lives in [../reverse/](../reverse/).

## Owner decisions (2026-10-16)

- Cursor's own prompt for Claude models is unavailable and out of scope.
- Claude prompts are built from the official Claude Code prompts by the conversion rule below, the rule Cursor applies to Codex prompts.
- All GPT models run on one prompt: Cursor's GPT-5.5 prompt, without changes in substance. Its dirty-git-tree rules stay.
- Every mention of Cursor as the product becomes OMP: "You operate in OMP.", "a coding agent in OMP", "styled by OMP".

## Conversion rule: Codex prompt to Cursor prompt

Derived from [Codex GPT-5.5](../reverse/codex-prompts/gpt-5.5.as-sent.md) → [Cursor GPT-5.5](../reverse/runs-2026-10-16/gpt-5.5/system-prompt-19362.md) and [Codex GPT-5.6](../reverse/codex-prompts/gpt-5.6-sol.md) → [Cursor Sol](../reverse/runs-2026-10-16/sol/system-prompt-15499.md). In our prompts every product name Cursor in these steps is OMP.

1. Replace the identity line with `You are <model>.`, `You operate in Cursor.` and the Cursor agent paragraph.
2. Insert Cursor's shared frame verbatim: `system-communication`, `mode_selection`, `dynamic_tools`, `terminal_files_information`, the "Citing Code Blocks" section, the `commentary`/`final` channels, image embedding, the pull-request link rule ("When you mention a pull request, issue, or similar resource…"), the "Never praise your plan…" rule and `main_goal`. This frame appears in both Cursor prompts; the blocks are byte-identical, the two single rules differ only in wording.
3. Keep from the model prompt only behavior: engineering judgment, editing constraints, review stance, autonomy, how to answer and report progress. Wrap each kept section in an XML tag block.
4. Drop personality, frontend design guidance, skills usage, shell-escaping and environment-variable rules, product-specific features, file-link formats and model catalog lines.
5. Rewrite the model prompt's "You prefer X" descriptions as imperatives ("Prefer X") where Cursor's rewriting applies; Cursor does this inconsistently and keeps some second-person sentences, such as "You provide user updates frequently, every 30s." and "If you create todos…", so text that is already written as instructions to "you" may stay as it is. Rename tools to Cursor's (`apply_patch` → `ApplyPatch`, `cat` → `ReadFile`).

## Prompts

[prompts/](prompts/) holds one file per model.

| Files | Source |
|---|---|
| `gpt-6-luna.md`, `gpt-6.1-sol.md`, `gpt-6-sol.md`, `gpt-5.6-sol.md`, `gpt-5.6-terra.md`, `gpt-5.6-luna.md` | Cursor GPT-5.5 main prompt; the files differ only in the line `You are <model>.` |
| `claude-opus-5-5.md`, `claude-sonnet-5-5.md` | [Claude Code 2.1.301](../reverse/claude-code-prompts/by-model/) system blocks 02–03, converted by the rule; the files differ only in the line `You are <model>.` |
| `claude-haiku-5-5.md` | The same, plus the Haiku-only paragraphs of Claude Code as `autonomy_and_persistence` |

## GPT-6.1 Sol release candidate (2026-10-16)

[prompts/gpt-6.1-sol-rc.md](prompts/gpt-6.1-sol-rc.md) is a separate OMP GPT-6.1 Sol release candidate based on [research/cursor/remaster/prompts/gpt-6.1-sol.md](prompts/gpt-6.1-sol.md), with four complete blocks copied verbatim, including their tags, from [research/cursor/reverse/runs-2026-10-16/sol/system-prompt-15499.md](../reverse/runs-2026-10-16/sol/system-prompt-15499.md): `epistemic_rigor`, `technical_communication`, `autonomy_and_persistence`, and `visualizations`. The donor reference to Cursor Canvas is preserved. All nine baseline prompts, including the GPT-5.5-derived files, remain unchanged. This records a prompt candidate only; it does not establish runtime parity or installation.

## GPT-6.1 Sol release candidate 2 (2026-10-16)

[prompts/gpt-6.1-sol-rc2.md](prompts/gpt-6.1-sol-rc2.md) is a second OMP GPT-6.1 Sol release candidate: [prompts/gpt-6.1-sol.md](prompts/gpt-6.1-sol.md), the Cursor GPT-5.5 prompt with the identity line `You are GPT-6.1 Sol.`, plus one paragraph in `<general>` after its first paragraph:

> Do not reflexively agree with or validate the user's premise. Verify uncertain claims, and when a claim is wrong or risky, say so directly and explain the technical reason.

The paragraph comes from the first paragraph of the Cursor GPT-5.6 Sol `<epistemic_rigor>` block without its framing sentence. The four full Cursor GPT-5.6 Sol blocks of the first candidate are left out: the Cursor GPT-5.5 prompt is the owner's reference experience, and those blocks repeat its communication rules and add longer explanations and a reference to Cursor Canvas. Further rules are added only for problems observed in use. The reasoning level is a run setting and is not part of the prompt. All other prompt files, including `gpt-6.1-sol-rc.md`, remain unchanged. This records a prompt candidate only; it does not establish runtime parity or installation.

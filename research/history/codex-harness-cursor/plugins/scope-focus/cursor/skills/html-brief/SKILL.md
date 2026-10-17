---
name: html-brief
description: Deliver concise, clear HTML reports in the fixed dark template; keep ordinary short answers in chat.
---

# HTML Brief

Use this skill for HTML reports and explanations that need several detailed sections. Keep short answers in chat unless the user requests HTML. Honor an explicit user format, including JSON, code, a letter, a long inline answer, or a prohibition on files. Do not duplicate an already requested suitable artifact. A request to explain in detail without another format uses HTML when several detailed sections are needed.

Read [the template](assets/report.html). Fill `{{TITLE}}`, `{{SUMMARY}}`, and `{{BLOCKS}}`. Put the direct result, what it means, and any material limitation in the visible summary. Repeat the supplied native details/summary block only for questions needed to answer the request. Escape inserted text as HTML. Long lines wrap and wide tables/code remain readable within their block.

Keep every report brief, including expanded blocks. Include only facts needed to answer the request or understand the result. Preserve required conditions, numbers, evidence, sources, errors, and uncertainty; honor an explicit request for depth. Remove repetition, work history, filler, incidental technical detail, empty sections, and generic advice. Include a next action only when required by the task or requested by the user.

Use the user's language and familiar words. Write short sentences and paragraphs, clear question headings, and restrained emphasis on key facts. Use compact tables when they make comparison easier. Keep source links short and direct. Brevity must not remove required meaning; use no fixed word or section count.

Keep the template's dark CSS and native markup. Change content only; do not redesign it or add JavaScript, mobile layouts, media queries, animation, external libraries, a renderer, or a JSON schema. A template redesign requires a separate request.

Create one HTML answer at a unique path inside the operating system's temporary directory (os.tmpdir() in Node.js). Do not save generated reports in the repository, a task outputs directory, a plugin cache, or a persistent external artifacts directory. Do not overwrite an unrelated same-name file. Provide the result, any material limitation or required question, and a direct file link in chat; use the existing viewer to show the file when available.

If the file cannot be created or delivered, state the limitation and give the available short result. If required content cannot be delivered without changing format, ask only the necessary format question. Do not claim the incomplete result is complete or install tools or a server to bypass the limitation. Verification follows the main prompt's ordinary reading-and-logic rule and explicit-evidence boundary.

The presentation idea draws on [Visual Explainer](https://github.com/nicobailon/visual-explainer). This minimal template uses the user's approved local design. Preserve applicable copyright and MIT notices if source text or code is copied from that project.

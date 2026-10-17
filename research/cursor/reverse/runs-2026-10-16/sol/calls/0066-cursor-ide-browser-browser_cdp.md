ARGS:
{"viewId":"b96778c6-f66a-4dae-89b3-c292774866ff","method":"Runtime.evaluate","params":{"expression":"(() => { const headings=[...document.querySelectorAll('h1,h2,h3')]; const h=headings.find(x=>x.textContent.trim()==='15.2.0'); const box=h?.closest('section, article, div.Box') || h?.parentElement?.parentElement; return {title:h?.textContent.trim(), text:box?.innerText.slice(0,250)}; })()","returnByValue":true}}

OUTPUT:
[
 {
  "text": "{\n  \"result\": {\n    \"type\": \"object\",\n    \"value\": {\n      \"text\": \"15.2.0\\n15.2.0 Latest\\nCompare\\n github-actions released this \\n 15.2.0 \\n e89fff8 \\n\\nSponsorship is appreciated!\\n\\nThis release fixes a number of bugs related to gitignore matching as well as\\nsome performance improvements in directory tree traversal.\\n\\nIn c\",\n      \"title\": \"15.2.0\"\n    }\n  }\n}",
  "type": "input_text"
 },
 {
  "text": "{\"type\":\"metadata\",\"viewId\":\"b96778c6-f66a-4dae-89b3-c292774866ff\"}",
  "type": "input_text"
 },
 {
  "text": "Screenshot failed: screen shot timed out, please try again",
  "type": "input_text"
 }
]
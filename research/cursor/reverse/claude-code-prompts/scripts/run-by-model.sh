#!/bin/bash
# One `claude -p` run on a given model behind capture-proxy.mjs (used for by-model/).
#
# Usage: run-by-model.sh <model> <label> <prompt>      (run from any directory)
#   needs next to this script's copy in the temp dir: capture-proxy.mjs, key.pem, cert.pem (self-signed, CN/SAN api.anthropic.com),
#   and an empty directory `work/` that is used as the working directory of every run.
#   Writes raw captures to out/<model>-<label>/ (NNN-v1_messages.body.json / .headers.json, index.jsonl, stdout.txt, stderr.txt).
# Environment of the claude process: DISABLE_AUTOUPDATER=1, CLAUDECODE unset, HTTPS_PROXY/HTTP_PROXY to the proxy,
#   NODE_TLS_REJECT_UNAUTHORIZED=0, NODE_EXTRA_CA_CERTS=<cert.pem>.
# Prompts used:  main:       "say ok"
#                subagents:  "Using the Agent tool, launch two subagents in parallel in one message: one with subagent_type Explore and one with
#                             subagent_type general-purpose. Each one should only list the file names in the current directory and report them in
#                             one line. Then reply with the word done."
MODEL=$1; LABEL=$2; PROMPT=$3
CCT=$(cd "$(dirname "$0")" && pwd)
OUT=$CCT/out/$MODEL-$LABEL
mkdir -p "$OUT"
node "$CCT/capture-proxy.mjs" "$OUT" "$CCT/key.pem" "$CCT/cert.pem" 0 > "$OUT/proxy.log" 2>&1 &
PP=$!
for i in $(seq 1 50); do grep -q LISTENING "$OUT/proxy.log" && break; sleep 0.1; done
PORT=$(awk '/LISTENING/{print $2}' "$OUT/proxy.log")
cd "$CCT/work" || exit 1
rm -rf ./* ./.[!.]* 2>/dev/null
env -u CLAUDECODE DISABLE_AUTOUPDATER=1 HTTPS_PROXY=http://127.0.0.1:$PORT HTTP_PROXY=http://127.0.0.1:$PORT \
  NODE_TLS_REJECT_UNAUTHORIZED=0 NODE_EXTRA_CA_CERTS=$CCT/cert.pem \
  ~/.local/bin/claude --model "$MODEL" -p "$PROMPT" > "$OUT/stdout.txt" 2> "$OUT/stderr.txt"
echo "exit=$?" > "$OUT/exit.txt"
sleep 1
kill $PP

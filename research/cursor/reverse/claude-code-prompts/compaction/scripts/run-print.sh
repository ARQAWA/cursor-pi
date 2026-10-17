#!/bin/bash
# One `claude -p` invocation behind scripts/capture-proxy.mjs (the response-saving proxy of this directory).
#
# Usage: WORKDIR=<empty dir> run-print.sh <label> <claude args...>
#   needs next to this script's working copy: capture-proxy.mjs, key.pem, cert.pem (self-signed, CN/SAN api.anthropic.com),
#   as in ../../scripts/run-by-model.sh. Raw captures go to out/<label>/ (NNN-v1_messages.body.json, .headers.json, .response.txt,
#   .response-headers.json, index.jsonl, stdout.txt, stderr.txt).
# Environment of the claude process: DISABLE_AUTOUPDATER=1, CLAUDECODE unset, HTTPS_PROXY/HTTP_PROXY to the proxy,
#   NODE_TLS_REJECT_UNAUTHORIZED=0, NODE_EXTRA_CA_CERTS=cert.pem.
#
# The runs of this capture (session ids are in the README):
#   run-print.sh t1 --model claude-opus-5-5 --output-format json -p "say ok"
#   run-print.sh t2 --model claude-opus-5-5 --output-format json --resume <id> -p "What is 17 plus 25? Answer with the number only."
#   run-print.sh t3 --model claude-opus-5-5 --output-format json --resume <id> -p "Name one primary color of light. One word."
#   run-print.sh t4-compact --model claude-opus-5-5 --output-format json --resume <id> -p "/compact"
#   run-print.sh t5-after --model claude-opus-5-5 --output-format json --resume <id> -p "What was the very first thing I asked you in this session, and what were your answers? Be brief."
#   (tool session, WORKDIR holds alpha.txt "hello from alpha" and an empty beta.txt, extra flags `--allowedTools Bash Read`)
#   k1: -p 'Run `ls` with the Bash tool and tell me the file names in one line.'
#   k2: --resume <id> -p 'Read alpha.txt with the Read tool and tell me what it says, in one short sentence.'
#   k3-compact: --resume <id> -p '/compact'
#   k4-after: --resume <id> -p 'Which files did you list earlier, and what did alpha.txt contain? Answer from memory without using any tools, one sentence.'
LABEL=$1; shift
CCT=$(cd "$(dirname "$0")" && pwd)
OUT=$CCT/out/$LABEL
mkdir -p "$OUT"
node "$CCT/capture-proxy.mjs" "$OUT" "$CCT/key.pem" "$CCT/cert.pem" 0 > "$OUT/proxy.log" 2>&1 &
PP=$!
for i in $(seq 1 50); do grep -q LISTENING "$OUT/proxy.log" && break; sleep 0.1; done
PORT=$(awk '/LISTENING/{print $2}' "$OUT/proxy.log")
cd "${WORKDIR:?set WORKDIR to an empty directory}" || exit 1
env -u CLAUDECODE DISABLE_AUTOUPDATER=1 HTTPS_PROXY=http://127.0.0.1:$PORT HTTP_PROXY=http://127.0.0.1:$PORT \
  NODE_TLS_REJECT_UNAUTHORIZED=0 NODE_EXTRA_CA_CERTS=$CCT/cert.pem \
  ~/.local/bin/claude "$@" > "$OUT/stdout.txt" 2> "$OUT/stderr.txt"
echo "exit=$?" > "$OUT/exit.txt"
sleep 1
kill $PP

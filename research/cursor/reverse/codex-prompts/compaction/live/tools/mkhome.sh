#!/bin/sh
# usage: mkhome.sh <home_dir> <workdir> <model> <effort> <port>
H=$1; W=$2; M=$3; E=$4; P=$5
rm -rf "$H"; mkdir -p "$H" "$W"
ln -s "$HOME/.codex/auth.json" "$H/auth.json"
cat > "$H/config.toml" <<EOT
model = "$M"
model_reasoning_effort = "$E"
approval_policy = "never"
sandbox_mode = "read-only"
openai_base_url = "http://127.0.0.1:$P/backend-api/codex"

[projects."$W"]
trust_level = "trusted"
EOT

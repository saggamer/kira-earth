#!/usr/bin/env bash
# Stage (and optionally publish) the app as a Hugging Face Docker Space.
#   deploy/hf-space.sh                       # stage only, into .hf-space/
#   deploy/hf-space.sh --push <user>/<name>  # stage, create the Space if needed, upload (needs `hf auth login`)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.hf-space"
rm -rf "$OUT" && mkdir -p "$OUT"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude .hf-space --exclude demo --exclude '*.pdf' \
  --exclude 'backend/.venv' --exclude 'backend/.cache' --exclude 'backend/.secrets' --exclude 'backend/ai/models' \
  --exclude 'backend/ai/data/prev-*' --exclude '*.bak' --exclude '*.log' --exclude '__pycache__' --exclude '._*' \
  --exclude '.DS_Store' --exclude '.pytest_cache' --exclude '.claude' --exclude '.git' \
  --exclude '.vercel' --exclude '.env' --exclude '.env.*' --exclude '.hyperframes' \
  "$ROOT/" "$OUT/"
# Spaces read their settings from the README front matter.
{ cat <<'YAML'
---
title: Trend Detective
emoji: 🌍
colorFrom: blue
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
short_description: What is changing on Earth, where, how much, and is it significant
---

YAML
  cat "$ROOT/README.md"; } > "$OUT/README.md"
echo "staged $(du -sh "$OUT" | cut -f1) in $OUT"
if [[ "${1:-}" == "--push" ]]; then
  REPO="${2:?usage: --push <user>/<space>}"
  hf repo create "$REPO" --repo-type space --space-sdk docker --exist-ok >/dev/null 2>&1 || hf repo create "$REPO" --repo-type space --space_sdk docker || true
  hf upload "$REPO" "$OUT" . --repo-type space --commit-message "Deploy Trend Detective"
  echo "Space: https://huggingface.co/spaces/$REPO  (first build takes a few minutes)"
fi

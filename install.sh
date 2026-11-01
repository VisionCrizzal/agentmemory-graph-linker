#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_SKILL_DIR="$HOME/.agents/skills/agentmemory-graph-linker"
GEMINI_SKILL_DIR="$HOME/.gemini/config/skills/agentmemory-graph-linker"
AGENTMEMORY_DIR="$HOME/.agentmemory"

echo "==> Installing agentmemory-graph-linker skill..."
mkdir -p "$HOME/.agents/skills" "$HOME/.gemini/config/skills" "$AGENTMEMORY_DIR"
rm -rf "$AGENTS_SKILL_DIR"
cp -R "$REPO_DIR/skill/agentmemory-graph-linker" "$AGENTS_SKILL_DIR"
chmod +x "$AGENTS_SKILL_DIR/scripts/graph-linker.mjs"
ln -sfn "$AGENTS_SKILL_DIR" "$GEMINI_SKILL_DIR"
echo "    ✓ Skill installed at: $AGENTS_SKILL_DIR"
echo "    ✓ Symlinked to:       $GEMINI_SKILL_DIR"

echo "==> Installing Smart AI Router (secret-free, reads from ~/.agentmemory/.env)..."
cp "$REPO_DIR/router/smart-router.mjs" "$AGENTMEMORY_DIR/smart-router.mjs"
echo "    ✓ Copied smart-router.mjs to $AGENTMEMORY_DIR/smart-router.mjs"

AGENTMEMORY_DIST="/usr/local/lib/node_modules/@agentmemory/agentmemory/dist/index.mjs"
if [ -f "$AGENTMEMORY_DIST" ]; then
  if grep -q "maxReads: 2048" "$AGENTMEMORY_DIST"; then
    echo "==> Patching queryGraphIndex maxReads (2048 -> 4096) in $AGENTMEMORY_DIST..."
    node -e '
      const fs = require("fs");
      const p = process.argv[1];
      let c = fs.readFileSync(p, "utf8");
      c = c.replace(
        "const reader = await createGraphIndexReader(state, {\n\t\t\tmaxReads: 2048,\n\t\t\tmaxBytes: 4 * 1024 * 1024\n\t\t});",
        "const reader = await createGraphIndexReader(state, {\n\t\t\tmaxReads: 4096,\n\t\t\tmaxBytes: 8 * 1024 * 1024\n\t\t});"
      );
      fs.writeFileSync(p, c);
    ' "$AGENTMEMORY_DIST"
    echo "    ✓ Patched maxReads to 4096"
  else
    echo "    ✓ queryGraphIndex maxReads is already patched (4096)"
  fi
fi

echo "==> Done! Test with:"
echo "    node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --status"

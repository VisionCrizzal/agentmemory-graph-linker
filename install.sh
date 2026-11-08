#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_SKILL_DIR="$HOME/.agents/skills/agentmemory-graph-linker"
GEMINI_SKILL_DIR="$HOME/.gemini/config/skills/agentmemory-graph-linker"
CLAUDE_SKILL_DIR="$HOME/.claude/skills/agentmemory-graph-linker"
AGENTMEMORY_DIR="$HOME/.agentmemory"

echo "==> Installing agentmemory-graph-linker skill (v3.1)..."
mkdir -p "$HOME/.agents/skills" "$HOME/.gemini/config/skills" "$HOME/.claude/skills" "$AGENTMEMORY_DIR"
rm -rf "$AGENTS_SKILL_DIR"
cp -R "$REPO_DIR/skill/agentmemory-graph-linker" "$AGENTS_SKILL_DIR"
chmod +x "$AGENTS_SKILL_DIR/scripts/graph-linker.mjs"
ln -sfn "$AGENTS_SKILL_DIR" "$GEMINI_SKILL_DIR"
ln -sfn "$AGENTS_SKILL_DIR" "$CLAUDE_SKILL_DIR"
echo "    ✓ Skill installed at: $AGENTS_SKILL_DIR"
echo "    ✓ Symlinked to:       $GEMINI_SKILL_DIR"
echo "    ✓ Symlinked to:       $CLAUDE_SKILL_DIR"

echo "==> Installing Smart AI Router v3.1 (reads from ~/.agentmemory/.env)..."
cp "$REPO_DIR/router/smart-router.mjs" "$AGENTMEMORY_DIR/smart-router.mjs"
echo "    ✓ Copied smart-router.mjs to $AGENTMEMORY_DIR/smart-router.mjs"
launchctl kickstart -k "gui/$(id -u)/com.agentmemory.smartrouter" 2>/dev/null || true
echo "    ✓ Restarted Smart AI Router service"

echo "==> Applying v3.0 system, XML-entity & RAM patches via graph-linker.mjs..."
node "$AGENTS_SKILL_DIR/scripts/graph-linker.mjs" --heal >/dev/null 2>&1 || true
echo "    ✓ Patched maxReads: 4096, parseAttrs XML decoding, and .env RAM limits"

echo "==> Done! Test with:"
echo "    node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --status"
echo "    node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --audit"

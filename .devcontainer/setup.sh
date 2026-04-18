#!/bin/bash
set -e

echo "[grove] Running setup..."

# Fix GPG key issues
apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 871920D1998BC54F 2>/dev/null || true

# Update package lists with --allow-insecure-repositories
apt-get update -o Acquire::AllowInsecureRepositories=true || true

# Install tmux
apt-get install -y --allow-unauthenticated tmux || apt-get install -y tmux || true

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || true
    apt-get install -y nodejs || true
fi

# Install agents
echo "[grove] Installing agents..."

# OpenCode
if command -v npm &> /dev/null; then
    npm install -g opencode 2>/dev/null || echo "[grove] opencode install failed (continuing)"
fi

# GitHub Copilot CLI
if command -v npm &> /dev/null; then
    npm install -g @github/copilot 2>/dev/null || echo "[grove] copilot install failed (continuing)"
fi

# Claude Code (requires node)
if command -v npm &> /dev/null; then
    npm install -g @anthropic-ai/claude-code 2>/dev/null || echo "[grove] claude-code install failed (continuing)"
fi

echo "[grove] Setup complete!"
which tmux && which node && which npm

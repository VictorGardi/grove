# Grove — Agent Guide

Grove is a local-first, file-based developer task orchestration tool built as an Electron desktop app.

## Purpose

Grove acts as an orchestration layer over developer repositories. It reads and writes Markdown files, manages git worktrees, and embeds a terminal so AI coding agents can be run directly without requiring API key management in the app itself.

## Core principles

- No auth, no login, no server, no cloud
- The repo is the source of truth — all tasks and decisions are stored as Markdown files inside the repo being worked on
- The app is a UI layer on top of the filesystem and git
- Multiple repos (workspaces) can be open in parallel, each with their own tasks, decisions, and running terminals
- Embedded terminals allow any CLI-based agent (Claude Code, Copilot CLI, Codex, Aider, OpenCode) to run without API key management in the app itself

## Repository structure

Tasks live in `.tasks/{backlog,doing,review,done}/` as Markdown files with YAML frontmatter.
Decisions live in `.decisions/` as Markdown files with YAML frontmatter.

See `VISION.md` for the full product specification.

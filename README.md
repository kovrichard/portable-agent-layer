# Portable Agent Layer (PAL)

A cross-platform, cross-agent layer for portable AI workflows, memory, and accumulated knowledge.

PAL lets you carry your agent context across **Windows**, **macOS**, and **Linux**, and work across different agent runtimes and interfaces such as **Claude Code**, **opencode**, **Cursor**, and **Codex**. Its core idea is simple: your knowledge and workflows should belong to **you**, not to a single machine, tool, or vendor.

> Inspired in part by [Daniel Miessler](https://danielmiessler.com)'s work on [Personal AI Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure). PAL is an independent open-source implementation focused on portability across platforms and agents. It is not affiliated with or endorsed by Daniel Miessler.

---

## Why PAL?

Most AI setups are fragmented.

Your prompts live in one place, your context in another, your notes somewhere else, and your workflows are often tied to a specific operating system or a specific agent tool.

PAL is designed to fix that.

With PAL, you can:

- keep your AI workflow portable
- move accumulated knowledge between machines
- work across multiple agent environments
- avoid lock-in to a single platform or interface
- build a durable personal layer that outlives any one tool

---

## Install

### Prerequisites

> **Bun is required.** PAL is built on [Bun](https://bun.sh) and will not work with Node.js or other runtimes. Install it with `curl -fsSL https://bun.sh/install | bash`.

- [Bun](https://bun.sh) >= 1.3.0
- At least one of: [Claude Code](https://claude.ai/code), [opencode](https://opencode.ai), [Cursor](https://cursor.com), or [Codex](https://openai.com/index/introducing-codex/)

### Package mode (recommended)

```bash
bun add -g portable-agent-layer
pal cli init
```

### Repo mode (for development / contributors)

```bash
git clone https://github.com/kovrichard/portable-agent-layer.git
cd portable-agent-layer
bun install
bun run install:all
```

In repo mode, add an alias to your shell profile:

```bash
alias pal="bun run ~/path/to/portable-agent-layer/src/cli/index.ts"
```

---

## Quick start

```bash
pal cli init          # scaffold home, install hooks for all targets
pal                   # start a Claude session (with session summary on exit)
pal cli status        # check your setup
```

---

## Commands

| Command | Description |
|---------|-------------|
| `pal` | Start a Claude session with session summary on exit |
| `pal cli init` | Scaffold PAL home directory and install hooks |
| `pal cli install` | Register hooks/skills for targets |
| `pal cli uninstall` | Remove hooks/skills for targets |
| `pal cli update` | Update PAL (git pull or npm update) and reinstall hooks |
| `pal cli export` | Export user state (telos, memory) to a zip |
| `pal cli import` | Import user state from a zip |
| `pal cli status` | Show current PAL configuration |
| `pal cli doctor` | Check prerequisites and system health |

### Target flags

`init`, `install`, and `uninstall` accept target flags:

```bash
pal cli install --claude      # Claude Code only
pal cli install --opencode    # opencode only
pal cli install --cursor      # Cursor only
pal cli install               # all available (default)
```

### Supported agents

| Agent | Support | Skills | Hooks | AGENTS.md | Subagents |
|-------|---------|--------|-------|-----------|-----------|
| Claude Code | Full | Yes | Yes | Yes | Yes |
| opencode | Full | Yes | Yes (plugin) | Yes | Yes |
| Cursor | Full | Yes | Yes | Yes (injected via hook) | Yes |
| GitHub Copilot | Full | Yes | Yes | Yes (via copilot-instructions.md) | Yes |
| Codex | Partial | Yes | No | Yes | No |

---

## Environment variables

### Required

| Variable | Description |
|----------|-------------|
| `PAL_ANTHROPIC_API_KEY` | Required for PAL's hook inference (sentiment analysis, session naming). Uses Haiku for low-cost background calls. |

### Optional

| Variable | Description |
|----------|-------------|
| `PAL_GEMINI_API_KEY` | For YouTube video analysis and web search skill  |
| `PAL_XAI_API_KEY` | For Grok real-time research skill (X/web search) |
| `PAL_PERPLEXITY_API_KEY` | For Perplexity deep research skill |
| `PAL_HOME` | Override user state directory (default: `~/.pal` or repo root) |
| `PAL_PKG` | Override package root |
| `PAL_CLAUDE_DIR` | Override Claude config dir (default: `~/.claude`) |
| `PAL_OPENCODE_DIR` | Override opencode config dir (default: `~/.config/opencode`) |
| `PAL_CURSOR_DIR` | Override Cursor config dir (default: `~/.cursor`) |
| `PAL_COPILOT_DIR` | Override Copilot config dir (default: `~/.copilot`) |
| `PAL_CODEX_DIR` | Override Codex config dir (default: `~/.codex`) |
| `PAL_AGENTS_DIR` | Override agents dir (default: `~/.agents`) |

---

## Skills

PAL ships with built-in skills that extend your agent's capabilities:

| Skill | Description |
|-------|-------------|
| `analyze-pdf` | Download and analyze PDF files |
| `analyze-youtube` | Analyze YouTube videos using Gemini |
| `council` | Multi-perspective parallel debate on decisions |
| `create-skill` | Scaffold a new skill from a description |
| `extract-entities` | Extract people and companies from content |
| `extract-wisdom` | Extract structured insights from content |
| `first-principles` | Break down problems to fundamentals |
| `fyzz-chat-api` | Query Fyzz Chat conversations via API |
| `reflect` | Diagnose why a PAL behavior didn't trigger |
| `research` | Multi-agent parallel research |
| `review` | Security-focused code review |
| `summarize` | Structured summarization |

---

## Core idea

PAL stands for **Portable Agent Layer**.

It is a layer that sits between **you** and the tools you use, helping preserve and transfer:

- context
- memory
- notes
- workflows
- reusable prompts
- agent-specific configurations
- accumulated knowledge

The emphasis is on **portability**.

Your setup should be able to travel with you.

---

## Features

- **Cross-platform**: works on Windows, macOS, and Linux
- **Cross-agent**: full support for Claude Code, opencode, and Cursor; partial support for Codex
- **Portable knowledge**: export and import accumulated knowledge
- **TypeScript-first**: built in TypeScript from day one
- **Open source**: hackable, inspectable, extensible
- **Composable**: intended to fit into real developer workflows

---

## Philosophy

PAL is built around a few simple beliefs:

- your AI context should be **portable**
- your workflows should be **tool-agnostic**
- your knowledge should be **exportable**
- your personal system should be **owned by you**
- agent tooling will change, but your layer should remain useful

---

## Who this is for

PAL is for people who want:

- a personal AI layer they control
- to switch between agents without losing continuity
- to move between machines without rebuilding everything
- a durable way to store and reuse context
- an open foundation for portable agent workflows

---

## License

[MIT](LICENSE)

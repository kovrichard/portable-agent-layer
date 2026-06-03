# Portable Agent Layer (PAL)

A cross-platform, cross-agent layer for portable AI workflows, memory, and accumulated knowledge.

PAL lets you carry your agent context across **Windows**, **macOS**, and **Linux**, and work across different agent runtimes and interfaces such as **Claude Code**, **opencode**, **Cursor**, **GitHub Copilot**, and **Codex**. Its core idea is simple: your knowledge and workflows should belong to **you**, not to a single machine, tool, or vendor.

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
- At least one of: [Claude Code](https://claude.ai/code), [opencode](https://opencode.ai), [Cursor](https://cursor.com), [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli), or [Codex](https://openai.com/index/introducing-codex/)

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
| `pal cli migrate` | Run pending data migrations (non-destructive) |
| `pal cli usage` | Summarize token usage and estimated cost |
| `pal cli knowledge` | Query & manage the knowledge store (search, graph, stats, hubs, find, show, add, ls, ingest) |
| `pal cli skill link <name>` | Link a personal `~/.pal/skills/<name>/` into every installed agent so it is discoverable |
| `pal cli skill doctor <name>` | Evaluate a skill against the authoring best practices (folder/file-name match, name, description, body length, point-of-view, reference depth) |

### Target flags

`init`, `install`, and `uninstall` accept target flags:

```bash
pal cli install --claude      # Claude Code only
pal cli install --opencode    # opencode only
pal cli install --cursor      # Cursor only
pal cli install               # all available (default)
```

### Supported agents

| Agent | Support | Skills | Hooks | AGENTS.md | Subagents | Inference routing |
|-------|---------|--------|-------|-----------|-----------|-------------------|
| Claude Code | Full | Yes | Yes | Yes | Yes | `claude --print` |
| opencode | Full | Yes | Yes (plugin) | Yes | Yes | `opencode run` |
| Cursor | Full | Yes | Yes | Yes (injected via hook) | Yes | `cursor-agent` |
| GitHub Copilot | Full | Yes | Yes | Yes (via `~/.copilot/instructions/*.instructions.md`) | Yes | `copilot` |
| Codex | Full | Yes | Yes | Yes | No | `codex exec` |

PAL's background inference (session naming, summaries, failure capture, etc.) runs through whichever subscription CLI is active — no API key required by default.

---

## Environment variables

### API keys (all optional)

PAL routes inference through the host agent's subscription CLI by default. API keys are only needed as fallbacks when no CLI binary is available, or for skills that call non-Anthropic providers.

| Variable | Description |
|----------|-------------|
| `PAL_ANTHROPIC_API_KEY` | Fallback for hook inference when no native CLI is available. Uses Haiku. |
| `PAL_OPENAI_API_KEY` | Fallback for hook inference when Codex is active without the `codex` binary, or when no Anthropic key is set. |
| `PAL_GEMINI_API_KEY` | For YouTube video analysis and web search skill |
| `PAL_XAI_API_KEY` | For Grok real-time research skill (X/web search) |
| `PAL_PERPLEXITY_API_KEY` | For Perplexity deep research skill |

### Path overrides

| Variable | Description |
|----------|-------------|
| `PAL_HOME` | Override user state directory (default: `~/.pal` or repo root) |
| `PAL_PKG` | Override package root |
| `PAL_CLAUDE_DIR` | Override Claude config dir (default: `~/.claude`) |
| `PAL_OPENCODE_DIR` | Override opencode config dir (default: `~/.config/opencode`) |
| `PAL_CURSOR_DIR` | Override Cursor config dir (default: `~/.cursor`) |
| `PAL_COPILOT_DIR` | Override Copilot config dir (default: `~/.copilot`) |
| `PAL_CODEX_DIR` | Override Codex config dir (default: `~/.codex`) |
| `PAL_AGENTS_DIR` | Override agents dir (default: `~/.agents`) |

### Debug / test

Enable verbose hook logging with:

```
pal cli debug on    # enable  → logs to memory/state/debug.log
pal cli debug off   # disable
pal cli debug       # show current status and log path
```

| Variable | Description |
|----------|-------------|
| `PAL_INFERENCE_DISABLED` | Set to `1` to disable all inference (used by the test suite to prevent real CLI spawns) |
| `PAL_NOTIFICATIONS_DISABLED` | Set to `1` to suppress desktop notifications (used by the test suite) |

---

## Skills

PAL ships with built-in skills that extend your agent's capabilities:

| Skill | Description |
|-------|-------------|
| `analyze-pdf` | Download and analyze PDF files |
| `analyze-youtube` | Analyze YouTube videos using Gemini |
| `consulting-report` | Generate consulting-style reports as PDFs |
| `council` | Multi-perspective parallel debate on decisions |
| `create-pdf` | Render structured content into a PDF |
| `create-skill` | Scaffold a new skill from a description |
| `entities` | Detect, save, and query people & companies in the personal knowledge graph |
| `extract-wisdom` | Extract structured insights from content |
| `first-principles` | Break down problems to fundamentals |
| `fyzz-chat-api` | Query Fyzz Chat conversations via API |
| `opinion` | Confirm or contradict tracked opinions (confidence-weighted) |
| `presentation` | Build branded slide decks from outlines |
| `projects` | Look up, resume, register, or manage tracked projects |
| `reflect` | Diagnose why a PAL behavior didn't trigger |
| `research` | Multi-agent parallel research |
| `review` | Security-focused code review |
| `summarize` | Structured summarization |
| `telos` | Inspect or update goals, beliefs, strategies, narratives |
| `think` | Structured first-pass reasoning on a problem |

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
- **Cross-agent**: full support for Claude Code, opencode, Cursor, GitHub Copilot, and Codex (Codex still lacks subagents)
- **Subscription-first inference**: background inference routes through whichever subscription CLI is active — no API key needed by default
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

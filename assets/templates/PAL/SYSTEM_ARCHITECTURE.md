# PAL System Architecture

<!--
SYSTEM ARCHITECTURE TEMPLATE
=============================
This file defines the GENERIC architecture patterns for any PAL installation.
These are the foundational patterns that apply to ALL PAL implementations.

WHAT GOES HERE:
- The Founding Principles (universal)
- Generic system patterns (skill structure, hook lifecycle, memory layout)
- Architecture diagrams showing how components interact
- Design philosophy and constraints

WHAT DOES NOT GO HERE:
- User-specific skill counts, configurations, or API keys
- Personal projects or deployment details
- Ephemeral state or session-specific information
-->

**The Founding Principles and Universal Architecture Patterns for the Portable Agent Layer**

---

## Core Philosophy

**PAL is scaffolding for AI, not a replacement for human intelligence.**

AI systems need structure to be reliable. Like physical scaffolding supports construction work, PAL provides the architectural framework that makes AI assistance dependable, maintainable, and effective — regardless of which AI agent runs underneath.

---

## The Founding Principles

### 1. Portability First

**PAL exists so your AI context, memory, and workflows survive any single tool.**

AI agents come and go. Your accumulated knowledge, preferences, and workflows should not be locked into one vendor's tool. PAL abstracts the agent-specific layer so the same skills, hooks, memory, and configuration work across Claude Code, opencode, and future agents.

**What portability means in practice:**
- No agent-specific assumptions in core logic
- Agent-specific code isolated in `src/targets/`
- Skills, memory, and TELOS are agent-agnostic
- A single `pal cli install --<agent>` registers everything

### 2. Cross-Platform by Default

**Every feature must work identically on macOS, Linux, and Windows.**

No platform-specific code without a portable fallback. Path resolution, shell commands, and file operations use cross-platform abstractions. Environment overrides (`PAL_HOME`, `PAL_PKG`, etc.) let users customize paths without touching code.

### 3. The Continuously Upgrading Algorithm

**The Algorithm is the gravitational center — everything else exists to serve it.**

PAL is built around a universal pattern for accomplishing any task: **Current State → Ideal State** via verifiable criteria. This pattern applies at every scale.

Everything feeds back into improving The Algorithm:
- The **Memory System** captures signals from every interaction
- The **Hook System** detects sentiment, ratings, and behavioral patterns
- The **Learning System** organizes evidence by session
- The **Wisdom System** crystallizes recurring patterns into principles
- The **Relationship System** tracks how the user works and what they prefer

### 4. Scaffolding > Model

**The system architecture matters more than the underlying AI model.**

A well-structured system with good scaffolding will outperform a more powerful model with poor structure. PAL's value comes from:
- Organized workflows that guide AI execution
- Routing systems that activate the right context
- Quality gates that verify outputs
- Memory systems that enable learning
- Feedback systems that provide awareness

### 5. As Deterministic as Possible

**Favor predictable, repeatable outcomes over flexibility.**

- Same input → Same output
- Behavior defined by code and hooks, not prompt variations
- Version control tracks explicit changes
- Hooks run deterministic TypeScript, not prompt-driven logic

### 6. Code Before Prompts

**Write code to solve problems, use prompts to orchestrate code.**

Prompts should never replicate functionality that code can provide:
- Hooks are TypeScript, not prompt instructions
- Tools are CLI programs, not natural language procedures
- Memory is structured JSON/JSONL, not freeform text
- Configuration is `pal-settings.json`, not prose in CLAUDE.md

### 7. Clear Thinking + Prompting is King

**The quality of outcomes depends on the quality of thinking and prompts.**

Before any code, before any architecture — there must be clear thinking:
- Understand the problem deeply before solving it
- Define success criteria before building
- Challenge assumptions before accepting them
- Simplify before optimizing

### 8. UNIX Philosophy

**Do one thing well. Compose tools through standard interfaces.**

- Each hook handler does one thing
- Each tool is a standalone CLI program
- Each skill is a self-contained capability
- Hooks compose via `Promise.allSettled` — independent, parallel, isolated failures
- Tools compose via `bun run tool:<name>` — standard I/O, exit codes

### 9. CLI as Interface

**Every operation should be accessible via command line.**

- `pal cli <command>` for system management
- `bun run tool:<name>` for utilities
- Skills triggered via agent slash commands
- No hidden operations — everything is scriptable and testable

### 10. Spec / Test First

**Define expected behavior before writing implementation.**

- Write tests before implementation
- Tests should fail initially
- Implement until tests pass
- Run `check-write`, `type-check`, and `test` after every edit

### 11. Custom Skill Management

**Skills are the organizational unit for all domain expertise.**

Skills are active orchestrators, not passive documentation:
- **Self-activating:** Trigger automatically based on user request
- **Self-contained:** Package all context, workflows, and tools
- **Composable:** Can invoke other skills and agents
- **Evolvable:** Easy to add, modify, or deprecate

### 12. Custom Memory System

**Automatic capture and preservation of valuable work.**

Every session, every insight, every decision — captured automatically:
- Relationship notes extracted via inference
- Learnings captured per session
- Ratings tracked (explicit and implicit)
- Wisdom crystallized from recurring patterns
- Failures logged for pattern avoidance

### 13. Permission to Fail

**Explicit permission to say "I don't know" prevents hallucinations.**

The AI has explicit permission to say "I don't know" when:
- Information isn't available in context
- Multiple conflicting answers seem equally valid
- Verification isn't possible

Fabricating an answer is far worse than admitting uncertainty.

---

## Skill System Architecture

### Canonical Skill Structure

```
assets/skills/<name>/
├── SKILL.md              # Main skill file (REQUIRED)
└── tools/                # CLI tools for automation (optional)
    └── tool-name.ts      # TypeScript CLI tool
```

### SKILL.md Format

```markdown
---
name: skill-name
description: What it does. Use when [triggers]. Capabilities.
---

# Skill Name

Brief description.

## Workflow
[Steps, decision trees, or procedures]
```

### Key Rules

- **Description**: Used by the agent for skill matching — be specific about triggers
- **One SKILL.md per skill**: The single entry point
- **Tools are optional**: Only add when the skill needs CLI automation
- **Skills are agent-agnostic**: No agent-specific assumptions in SKILL.md

---

## Hook System Architecture

### Lifecycle

```
┌─────────────────────┐
│   Session Start     │──► LoadContext.ts
│                     │    - Regenerate CLAUDE.md if stale
│                     │    - Inject dynamic context (system-reminder)
└─────────────────────┘

┌─────────────────────┐
│  User Prompt Submit │──► UserPromptOrchestrator.ts
│                     │    - Rating capture (explicit/implicit)
│                     │    - Session naming (first prompt)
└─────────────────────┘

┌─────────────────────┐
│   Pre Tool Use      │──► SecurityValidator.ts
│                     │    - Bash command validation
│                     │    - File path validation
│                     │──► SkillGuard.ts
│                     │    - Block false-positive skill matches
└─────────────────────┘

┌─────────────────────┐
│       Stop          │──► StopOrchestrator.ts
│                     │    - Work session capture
│                     │    - Relationship extraction (Haiku inference)
│                     │    - Work learning capture
│                     │    - Failure logging
│                     │    - Reflect trigger check
│                     │    - Auto-backup
│                     │    - Count updates
│                     │    - Tab reset
└─────────────────────┘
```

### Design Principles

- **Fail-open**: Hook errors never block the user's session
- **Parallel execution**: Stop handlers run via `Promise.allSettled` — one failure doesn't block others
- **Idempotent**: Handlers check for existing state before writing (e.g., session dedup)
- **Timeout-aware**: Inference calls have hard timeouts (8s default)
- **Subagent-aware**: `LoadContext.ts` skips heavy context loading for subagent sessions

### Configuration

Hooks are registered in the agent's settings file during `pal cli install`:

```json
{
  "hooks": {
    "SessionStart": [{ "type": "command", "command": "bun run <path>/LoadContext.ts" }],
    "UserPromptSubmit": [{ "type": "command", "command": "bun run <path>/UserPromptOrchestrator.ts" }],
    "PreToolUse": [
      { "type": "command", "command": "bun run <path>/SecurityValidator.ts", "matcher": "Bash" },
      { "type": "command", "command": "bun run <path>/SkillGuard.ts", "matcher": "Skill" }
    ],
    "Stop": [{ "type": "command", "command": "bun run <path>/StopOrchestrator.ts" }]
  }
}
```

---

## Memory System Architecture

### Directory Structure

```
memory/
├── state/                         # Runtime state
│   ├── sessions.json              # Session registry (name, cwd, status, summary)
│   ├── projects.json              # Multi-session project tracking
│   ├── counts.json                # Cached counts for greeting
│   ├── last-responses.json        # Cached responses for rating correlation
│   ├── pending-failure.json       # Deferred failure capture
│   └── debug.log                  # Hook execution logs
│
├── signals/                       # User feedback
│   └── ratings.jsonl              # Explicit + implicit ratings
│
├── relationship/                  # Interaction tracking
│   ├── YYYY-MM/
│   │   └── YYYY-MM-DD.md         # Daily notes (W/O/B format)
│   ├── opinions.json              # Confidence-tracked opinions
│   └── reflections/               # Periodic reflection reports
│
├── session-learning/              # Per-session learnings
│   └── YYYY-MM/
│       └── YYYY-MM-DD_title.md    # Session learning with frontmatter
│
├── failures/                      # Low-rating context dumps
│   └── YYYY-MM/
│       └── YYYY-MM-DD_context.md  # Failed session context for avoidance
│
├── wisdom/                        # Crystallized principles
│   └── frames/
│       └── domain.md              # Domain-specific principles with confidence
│
└── synthesis/                     # Pattern aggregation
    └── YYYY-MM/
        └── YYYY-MM-DD_period.md   # Weekly/monthly synthesis reports
```

### Data Flow

```
Session interaction
  │
  ├─► [Stop] Rating capture ──► signals/ratings.jsonl
  │
  ├─► [Stop] Relationship extraction (Haiku) ──► relationship/YYYY-MM/YYYY-MM-DD.md
  │
  ├─► [Stop] Work learning capture ──► session-learning/YYYY-MM/...
  │
  ├─► [Stop] Failure capture (low ratings) ──► failures/YYYY-MM/...
  │
  ├─► [Periodic] Reflect trigger ──► relationship/opinions.json
  │                                  relationship/reflections/...
  │
  ├─► [Periodic] Synthesis ──► synthesis/YYYY-MM/...
  │
  └─► [Periodic] Wisdom graduation ──► wisdom/frames/...
```

### Relationship Note Format

Three note types, captured via Haiku inference at session end:

```
W — World facts (user's situation, projects, tools)
O(c=0.85) — Opinions/preferences with confidence
B(c=0.75) — Beliefs/behavioral patterns with confidence
```

### Opinion Lifecycle

```
Relationship notes (O/B types)
  │
  ├─► Reflect tool groups similar notes
  │   ├─► 2+ occurrences → new opinion at 50% confidence
  │   └─► Matches existing → +2% supporting evidence
  │
  ├─► AI confirmation → +10% (via tool:opinion)
  ├─► AI contradiction → -20% (via tool:opinion)
  │
  └─► At ≥85% confidence → auto-injected into session context
```

---

## Context Loading Architecture

### Two-Layer Design

**Static context** (loaded natively by the agent):
- CLAUDE.md — identity, modes, context routing table
- Loaded once at session start, always available

**Dynamic context** (injected by LoadContext hook):
- Changes per-session, can't live in a static file
- Injected as `<system-reminder>` block to stdout
- Each section independently toggleable in `pal-settings.json → dynamicContext`

### Injection Order

```
LoadContext.ts
  │
  ├─► Regenerate CLAUDE.md if template/telos changed
  │
  └─► Build system-reminder:
      1. loadAtStartup files (user-configured)
      2. Crystallized principles (wisdom frames)
      3. Tracked opinions (≥85% confidence)
      4. Recent interaction notes (last 2 days)
      5. Learning digest (this project + other recent)
      6. Pattern synthesis recommendations
      7. Signal trends (today/week/trend)
      8. Failure patterns (last 5 low-rating contexts)
      9. Active work summary (sessions + projects)
```

### On-Demand Context

Everything else loads via the routing table in CLAUDE.md. The AI reads files only when the current task requires that context — no upfront loading of the full system.

---

## Security Architecture

### Fail-Open Design

`SecurityValidator.ts` runs on PreToolUse for Bash commands. It blocks known-dangerous patterns but never prevents legitimate work:

- **Blocked**: `rm -rf /`, `chmod 777`, known secret file paths, command injection patterns
- **Allowed**: Everything else passes through
- **On error**: The hook exits silently — a broken security hook never blocks the user

### What's Protected

- Dangerous shell commands (recursive deletes, permission changes)
- Known secret file paths (.env, credentials, key files)
- Command injection patterns in arguments

### What's NOT Protected

PAL does not implement:
- Network-level security (no firewall, no proxy)
- File encryption (memory is plaintext on disk)
- Access control (anyone with filesystem access can read memory)

Users are responsible for securing their own machine and API keys.

---

## Cross-Platform Architecture

### Agent Abstraction

```
src/targets/
├── claude/          # Claude Code specific
│   ├── install.ts   # Register hooks + skills in ~/.claude/settings.json
│   └── uninstall.ts
├── opencode/        # opencode specific
│   ├── install.ts   # Register hooks + skills in opencode config
│   ├── uninstall.ts
│   └── plugin.ts    # opencode plugin interface
├── cursor/          # Cursor specific
│   ├── install.ts   # Register hooks + skills in ~/.cursor/
│   └── uninstall.ts
└── lib.ts           # Shared: JSON read/write, settings merge, TELOS scaffold
```

Codex support is partial — AGENTS.md is symlinked to `~/.codex/AGENTS.md` automatically (no dedicated target installer needed).

### Path Resolution

All paths resolve through `src/hooks/lib/paths.ts`:

| Path | Default | Override |
|------|---------|----------|
| PAL home | `~/.pal` | `PAL_HOME` |
| PAL package | Auto-detected from source | `PAL_PKG` |
| Claude config | `~/.claude` | `PAL_CLAUDE_DIR` |
| opencode config | `~/.config/opencode` | `PAL_OPENCODE_DIR` |
| Cursor config | `~/.cursor` | `PAL_CURSOR_DIR` |
| Codex config | `~/.codex` | `PAL_CODEX_DIR` |
| Agents dir | `~/.agents` | `PAL_AGENTS_DIR` |

### Portability Contract

- Core logic (`src/hooks/lib/`, `src/tools/`) has zero agent-specific imports
- Agent-specific code lives only in `src/targets/`
- Skills reference no agent-specific APIs
- Memory format is plain JSON/JSONL/Markdown — readable by any tool

---

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Skill directory | kebab-case | `extract-wisdom/`, `first-principles/` |
| SKILL.md | Uppercase | `SKILL.md` |
| Hook files | PascalCase | `LoadContext.ts`, `StopOrchestrator.ts` |
| Handler files | kebab-case | `session-name.ts`, `work-learning.ts` |
| Library files | kebab-case | `text-similarity.ts`, `signal-trends.ts` |
| Tool files | kebab-case | `relationship-reflect.ts`, `token-cost.ts` |
| Memory files | date-prefixed | `2026-03-24.md`, `2026-03-24_weekly.md` |
| Template files | UPPER_SNAKE | `ALGORITHM.md`, `CONTEXT_ROUTING.md` |

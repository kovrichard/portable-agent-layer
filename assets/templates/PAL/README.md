# PAL — Portable Agent Layer

PAL is a persistent, cross-platform, cross-agent layer for portable AI workflows, memory, and accumulated knowledge. It runs inside any compatible AI coding agent (Claude Code, opencode, Cursor, Codex) as an interconnected set of skills, hooks, tools, memory, and configuration — all orchestrated by The Algorithm.

## How It Works

**CLAUDE.md** (or the agent equivalent) is the entry point — generated from a template by the CLI installer. It defines execution modes, The Algorithm routing, and the context routing table. The agent loads it natively every session. A SessionStart hook keeps it fresh automatically.

**The PAL home directory (`~/.pal/`)** contains all system documentation, user context (TELOS), memory, and tools. The rest of the system lives in the PAL package (`src/`) and the agent's config directory (`~/.claude/`, `~/.config/opencode/`, `~/.cursor/`, or `~/.codex/`).

## Directory Structure

```
~/.pal/                            # PAL home
  docs/                            # System documentation (engine-managed)
    ALGORITHM.md                   # The execution engine (4-phase)
    MEMORY_SYSTEM.md               # Memory guidelines
    OPINION_TRACKING.md            # Opinion system reference
    STEERING_RULES.md              # Behavioral rules
    WORK_TRACKING.md               # Work tracking reference
  tools/                           # Agent CLI tools (symlink → repo src/tools/agent/)
  skills/                          # Installed skills (symlinks → assets/skills/)
  telos/                           # User life context (TELOS)
    MISSION.md, GOALS.md, BELIEFS.md,
    CHALLENGES.md, STRATEGIES.md, IDEAS.md, LEARNED.md,
    MODELS.md, NARRATIVES.md

<PAL package>/                     # The PAL codebase
  src/
    cli/                           # CLI entry point (pal command)
    hooks/                         # Session lifecycle hooks
      handlers/                    # Individual stop/prompt handlers
      lib/                         # Shared utilities
    targets/                       # Agent-specific installers (Claude, opencode, Cursor)
    tools/                         # Standalone CLI tools
  assets/
    skills/                        # Bundled skills (16+)
    templates/PAL/                 # Templates for PAL home files

<PAL package>/memory/              # Persistent memory (gitignored)
  state/                           # Runtime state (sessions, counts, caches)
  signals/                         # Rating signals (ratings.jsonl)
  relationship/                    # Daily interaction notes + opinions
    YYYY-MM/YYYY-MM-DD.md          # Daily relationship notes
    opinions.json                  # Confidence-tracked opinions
    reflections/                   # Periodic reflection reports
  session-learning/                # Per-session learnings
  failures/                        # Low-rating context dumps
  wisdom/                          # Crystallized principles (frames)
  synthesis/                       # Pattern synthesis reports
```

## Core Subsystems

### The Algorithm (`ALGORITHM.md`)
The 4-phase execution engine: Observe, Plan, Execute, Verify. Transitions from CURRENT STATE to IDEAL STATE via verifiable criteria. Used for all complex work.

### Three Execution Modes
Every response uses exactly one mode:
- **MINIMAL** — Greetings, acknowledgments
- **NATIVE** — Simple, quick tasks
- **ALGORITHM** — Multi-step, complex work (invokes the full 4-phase engine)

### Skills (`assets/skills/`)
Bundled skills installed into the agent's skill directory. Each has a `SKILL.md` defining triggers, workflows, and capabilities. Skills are the primary capability unit — they tell the AI what it can do and when to do it.

### Hooks (`src/hooks/`)
Event hooks across the session lifecycle:
- **SessionStart** → `LoadContext.ts` — inject dynamic context, regenerate CLAUDE.md if stale
- **UserPromptSubmit** → `UserPromptOrchestrator.ts` — rating capture, session naming
- **PreToolUse** → `SecurityValidator.ts` — block dangerous commands; `SkillGuard.ts` — block false-positive skill matches
- **Stop** → `StopOrchestrator.ts` — work tracking, relationship capture, learnings, backups, reflect trigger

### Memory (`memory/`)
Persistent storage across sessions:
- **signals/** — User satisfaction ratings (explicit + implicit)
- **relationship/** — Daily interaction notes, confidence-tracked opinions, reflection reports
- **session-learning/** — Per-session context and learnings
- **failures/** — Low-rating session context dumps for pattern avoidance
- **wisdom/** — Crystallized principles that compound over time
- **synthesis/** — Weekly pattern synthesis reports
- **state/** — Session registry, counts cache, debug logs

### Tools (`src/tools/`)
CLI utilities: `tool:opinion` (manage opinions), `tool:reflect` (relationship reflection), `tool:analyze` (learning analysis), `pal cli usage` (token usage tracking), `pal cli export` / `pal cli import` (state portability).

### TELOS (`telos/`)
Personal context system — mission, goals, projects, beliefs, challenges, strategies, ideas, learnings, mental models, narratives. Managed via the telos skill.

### Security (`SecurityValidator.ts`)
Hook-based security: validates Bash commands and file operations against dangerous patterns. Fail-open design — blocks known-dangerous operations without breaking legitimate work.

## Startup & Context Loading

At session start, three things happen:
1. **CLAUDE.md** loads natively (identity, modes, routing table)
2. **`loadAtStartup` files** from `pal-settings.json` are loaded by `LoadContext.ts`
3. **Dynamic context** injected by `LoadContext.ts`: crystallized principles, tracked opinions (≥85%), recent interaction notes, learning digest, signal trends, failure patterns, active work summary — each toggleable in `pal-settings.json → dynamicContext`

All other documentation loads on-demand via the routing table in CLAUDE.md.

## CLI

```
pal                          # Start agent session with auto-summary on exit
pal cli init                 # Scaffold PAL home + install hooks
pal cli install [--claude]   # Register hooks/skills for Claude Code
pal cli install [--opencode] # Register hooks/skills for opencode
pal cli install [--cursor]   # Register hooks/skills for Cursor
pal cli uninstall            # Remove hooks/skills
pal cli status               # Show configuration
pal cli doctor               # Check prerequisites and health
pal cli export [path]        # Export user state to zip
pal cli import [path]        # Import state from zip
pal cli update               # Update PAL
```

## Cross-Platform & Cross-Agent

PAL is designed to work identically across:
- **Platforms:** macOS, Linux, Windows
- **Agents:** Claude Code (full), opencode (full), Cursor (full), Codex (partial — AGENTS.md and skills only, no hooks or subagents)
- **Environment overrides:** `PAL_HOME`, `PAL_PKG`, `PAL_CLAUDE_DIR`, `PAL_OPENCODE_DIR`, `PAL_CURSOR_DIR`, `PAL_CODEX_DIR`, `PAL_AGENTS_DIR`

## Extending PAL

- **Add a skill:** Use the `create-skill` skill or manually create `assets/skills/<name>/SKILL.md`
- **Add startup files:** Append to `pal-settings.json → loadAtStartup.files`
- **Add user context:** Create files in `~/.pal/telos/`
- **Toggle dynamic context:** Set keys in `pal-settings.json → dynamicContext` to `false`

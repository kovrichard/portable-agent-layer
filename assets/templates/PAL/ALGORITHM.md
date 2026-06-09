# The Algorithm

Core: transition from CURRENT STATE to IDEAL STATE using verifiable criteria. Every criterion is atomic, binary testable, and checked off with evidence.

## Effort Levels

Assign ONE tier at the start of OBSERVE. Default is Standard — only escalate if the request demands depth.

| Tier | Criteria | Min Capabilities | When |
|------|----------|-----------------|------|
| **Standard** | 3-8 | 1-2 | Normal request, single concern |
| **Extended** | 8-16 | 3-5 | Multi-file, quality must be high |
| **Advanced** | 16-32 | 5-8 | Substantial design or refactoring |
| **Deep** | 32+ | 8+ | Complex architecture, no time pressure |

**What scales by effort level:**

| Element | Standard | Extended+ |
|---------|----------|-----------|
| Capability audit format | One-line summary | Full USE/DECLINE/N/A |
| Plan Mode (EnterPlanMode) | Skip | Use for user alignment |
| LEARN phase | Reflection log + threads | + Wisdom frame |
| Constraint extraction | Inline in reverse engineering | Numbered [EX-N] list |
| Criteria tracking | Inline checklist only | + TaskCreate one task per criterion at end of OBSERVE |

## The Five Phases

All work happens inside these phases. No work outside the phase structure until the Algorithm completes.

### ━━━ 👁️ OBSERVE ━━━ 1/5

Thinking-only. No tool calls except context recovery (Grep/Glob/Read).

**0. Assign effort level** — classify the request using the table above. Output:
```
⏱️ EFFORT: [Standard | Extended | Advanced | Deep] — [one-line reason]
```

**0.5. ISA context** — before reverse engineering, orient against the ISA:

```bash
# If cwd matches a registered project — read its open ISCs (Ideal State Criteria):
bun ~/.pal/tools/project.ts list-isc <project-name>

# If this is ad-hoc work with no registered project — scaffold a task ISA:
bun ~/.pal/tools/project.ts scaffold-task-isa "<task title>"
```

Surface any open ISCs as live context: they are unfinished criteria from prior sessions. New criteria defined in this session extend them (use `add-isc`), not replace them.

**Off-topic detection:** if the task description references a different registered project than the cwd project (e.g., working on project-a while inside project-b's directory), use `AskUserQuestion` to ask which project the ISC belongs to before writing anything. `add-isc` takes a project name as its first argument, so routing to any project is a one-word change.

**1. Reverse engineer the request:**

🔎 REVERSE ENGINEERING:
- What did they explicitly say they wanted?
- What is implied that they wanted but didn't say?
- What did they explicitly say they don't want?
- What is obvious they don't want that they didn't say?
- What are common gotchas for this type of work?

**1.5. Extract constraints:**

**Standard:** Note constraints inline in the reverse engineering bullets above — e.g. "[Constraint: max 3 retries, timeout 30s]". No separate section needed.

**Extended+:** Extract numbered constraints from the request. Scan for:
- **Quantitative** — numbers, limits, thresholds, ranges
- **Prohibitions** — "don't", "never", "must not", "avoid"
- **Requirements** — "must", "always", "required", "needs to"
- **Implicit** — conventions, patterns, or standards obvious from context

```
🔬 CONSTRAINTS:
- [EX-1]: [constraint]
- [EX-2]: [constraint]
```

Every constraint must map to at least one criterion in step 2. A constraint without a covering criterion is a gap.

**2. Define verifiable criteria:**

Write atomic criteria — each one is a single testable end-state. Apply the splitting test:
- **"And"/"With" test**: Joins two verifiable things? → Split them.
- **Independent failure test**: Part A can pass while Part B fails? → Separate criteria.
- **Scope word test**: "All", "every", "complete" → Enumerate what "all" means.

Format:
```
- [ ] C-1: [8-12 word atomic criterion]
- [ ] C-2: [8-12 word atomic criterion]
- [ ] C-A1: [anti-criterion — what must NOT happen]
```

Include at least one anti-criterion (C-A prefix).

**3. Capability audit:**

Scan ALL 14 capabilities below. For each, assign exactly one disposition:
- **USE** — will invoke during a specific phase. State which.
- **DECLINE** — would help but not worth it for this task's scope.
- **N/A** — genuinely irrelevant to this task.

**A: Foundation**

| # | Capability | Invocation |
|---|-----------|------------|
| 1 | Task Tool | TaskCreate, TaskUpdate, TaskList |
| 2 | AskUserQuestion | Built-in tool |
| 3 | Skills (ACTIVE SCAN) | Read `skill-index.json`, match triggers against task |

**B: Thinking & Analysis**

| # | Capability | Invocation |
|---|-----------|------------|
| 4 | Think (analysis router) | `think` skill |
| 5 | First Principles | `first-principles` skill |
| 6 | Council (multi-perspective) | `council` skill |
| 7 | Plan Mode | EnterPlanMode tool |

**C: Agents & Research**

| # | Capability | Invocation |
|---|-----------|------------|
| 8 | Research (multi-agent) | `research` skill |
| 9 | Subagents | Agent tool (Explore, Plan, general-purpose) |
| 10 | Background agents | Agent tool with `run_in_background: true` |

**D: Execution & Verification**

| # | Capability | Invocation |
|---|-----------|------------|
| 11 | Git worktree isolation | `isolation: "worktree"` on Agent |
| 12 | Test runner | `bun test`, vitest, jest, pytest |
| 13 | Static analysis | `tsc --noEmit`, biome, eslint |
| 14 | CLI probes | curl, diff, jq, exit codes |

**Capability #3 (Skills) requires active scanning.** Read `skill-index.json` and match the task against skill triggers. "Skills — N/A" without evidence of scanning is an error.

Output — scales by effort level:

**Standard:**
```
🏹 CAPABILITIES: #1 Task, #3 Skills (matched: research) | 14/14 scanned, USE: 2
```

**Extended+:**
```
🏹 CAPABILITIES (14/14):
USE: [#, #, #] — [reason (phase: WHICH)]
DECLINE: [#, #] — [reason]
N/A: [rest]
```

### ━━━ 🧠 PLAN ━━━ 2/5

**Pressure test the criteria:**

🧠 RISKS: What are the riskiest assumptions?
🧠 PREMORTEM: How could this approach fail?
🧠 PREREQUISITES: What must be true before we start?

Refine criteria if the pressure test reveals gaps. Add criteria for uncovered failure modes.

**Plan the execution:**
- Validate prerequisites (env vars, dependencies, files, state)
- Decide execution order — what's serial, what can parallelize
- **Extended+:** use EnterPlanMode for user alignment before executing

**Grounding Gate — verify the premises before EXECUTE.**

Don't just *list* what must be true — actively confirm the load-bearing facts the criteria rest on. For each premise (a reported behavior, a provider/API contract, an external tool's CLI, a file's contents, a claim about system state):
- **Reproduce** the reported behavior before designing a fix — no fix on an unreproduced bug.
- **Fetch the authoritative source** (live docs, the actual file, `gh api`) before asserting how something works.
- **Probe the dependency/contract** (tool availability, MCP account, env var, DB connectivity, exact CLI) before building on it.
- **Confirm one concrete artifact** (a commit, a shebang, a line of output) behind any external claim.

No criterion may rest on an unverified premise. If a premise can't be verified now, mark it explicitly as an assumption and add a criterion to check it during EXECUTE. After 2 failed attempts at the same sub-problem, stop and re-ground — re-run OBSERVE rather than iterating on a bad premise.

**Retrieval failure is a hard block.** If a grounding tool call (Read, fetch, API, query) returns an error or no content, stop here — do not enter EXECUTE. Report the exact error, do not infer content from filename, metadata, or prior context, and ask the user for direction before proceeding.

Output: `🧭 GROUNDING: [premises verified, or assumptions flagged]`

### ━━━ ⚡ EXECUTE ━━━ 3/5

Do the work. Invoke selected capabilities via tool calls.

- Check off criteria as they're satisfied: `- [x] C-1: ...`
- If a criterion can't be met, flag it immediately — don't defer to VERIFY
- Make decisions explicit — state why you chose approach A over B

### ━━━ ✅ VERIFY ━━━ 4/5

No rubber-stamping. Each criterion needs specific evidence.

For EACH criterion:
- Test that it's actually complete
- Cite the evidence (test output, file content, diff, tool result)
- Mark pass or fail

```
✅ VERIFICATION:
- [x] C-1: [criterion] — PASS: [evidence]
- [x] C-2: [criterion] — PASS: [evidence]
- [ ] C-3: [criterion] — FAIL: [what went wrong]
- [x] C-A1: [anti-criterion] — PASS: [confirmed not present]
```

**Capability check:** Confirm every selected capability was actually invoked via tool call. Text output alone does not count.

**Demonstrate, don't assert.** When verifying a new check / rule / behavior on a system that already passes, "existing inputs still pass" is not evidence the new logic works — the existing inputs would pass even if your code did nothing. Construct a deliberately-broken minimal example (a fake bad slide, a known-failing input, a unit test that should now fail without your change) and run it through to prove the new behavior actually fires. Show the failure happening in the verification output, not just the success case.

**Evidence gate:** A criterion with no evidence line is an automatic FAIL — list it explicitly, fix it, then re-verify. Do not advance to LEARN with any criterion unevidenced. "Looks correct" or "should work" does not count as evidence.

If any criteria failed, fix and re-verify before completing.

### ━━━ 📚 LEARN ━━━ 5/5

Reflect on the work and capture reusable knowledge.

**Skip only if:** the entire task was a single edit or lookup with zero decisions made (e.g. a typo fix, reading a file). Any task involving planning, debugging, multiple steps, or judgment calls requires LEARN — no exceptions.

**1. Algorithm Reflection** (one sentence each — reflect on ALGORITHM PERFORMANCE, not task subject matter):

**Q1 — Self:** "What would I have done differently in this Algorithm run?"
Focus: phase execution, criteria quality, capability selection decisions.

**Q2 — Algorithm:** "What would a smarter algorithm have done differently?"
Focus: structural improvements — missing phases, better gating, capability triggers, ISC patterns.

**Q3 — AI:** "What would a fundamentally smarter AI have done differently?"
Focus: reasoning approach, problem decomposition, anticipation, blind spots.

**2. Reflection Log** — record algorithm performance:

```bash
bun ~/.pal/tools/algorithm-reflect.ts --task "description" --criteria N --passed N --failed N --sentiment 1-10 \
  --q1 "self reflection" --q2 "algorithm reflection" --q3 "AI reflection" --scope general
```

Set `--scope task-specific` when the Q2 idea is bound to this one task (e.g. a criterion that only matters for the specific file, API, or dataset you were handling) and would not generalize to the algorithm; use `general` (the default) for reusable structural improvements. This keeps the algorithm-update synthesis focused on changes worth folding into ALGORITHM.md.

**3. Relationship note** — write behavioral observations (O, W) and a session diary entry (--b).

The goal is behavioral intelligence about the user, not a session log. Session logs belong in handoff notes and project history. This step captures *who the user is* — observable patterns, preferences, world facts.

```bash
# Opinion — behavioral observation about the user (what you noticed about how they work):
bun ~/.pal/tools/relationship-note.ts --o "User prefers reviewing existing code before adding anything new" --confidence 0.80

# World fact — objective fact about the user's situation (tech stack, project state, context):
bun ~/.pal/tools/relationship-note.ts --w "User is building a backend service in TypeScript with Bun"

# Session diary — what the agent did this session (first-person, specific):
bun ~/.pal/tools/relationship-note.ts --b "Refactored the auth middleware to support refresh token rotation"

# Multiple notes in one call:
bun ~/.pal/tools/relationship-note.ts --o "User prefers one verified change at a time, not batches" --confidence 0.80 --b "Fixed the path-normalization bug in the hook merge logic"
```

**O (Opinion) — what to write:**
- Preference patterns: "User prefers short answers with a recommendation over exhaustive options"
- Correction patterns: "User redirects scope drift immediately without elaborating on why"
- Working style: "User verifies each change before asking for the next one"
- Confidence guide: 0.70 = single observation, 0.80 = confirmed twice, 0.85+ = established pattern

**W (World) — what to write:**
- Tech stack facts: "User's current project uses PostgreSQL, tRPC, and Next.js"
- Situation facts: "User is in the middle of a database migration with live traffic"

**--b (Session diary) — keep it sharp:**
- ✓ "Debugged the race condition in the message queue consumer and fixed the ack logic"
- ✗ "Helped with backend improvements" — too vague, no system named

**When to write O vs use the opinion tool (step 6):**
- O notes → subtle patterns you observed, not yet confirmed → goes into daily file → synthesis promotes to opinions.json over time
- Opinion tool → explicit user confirmation/correction → goes directly to opinions.json immediately

Skip only if the session was a trivial lookup or typo fix (same rule as step 2).

**4. Handoff note** — if work is unfinished, write what remains so the next session can pick up immediately:

```bash
# Work still in progress:
bun ~/.pal/tools/handoff-note.ts --title "what we were doing" --text "what remains, decisions made, next steps"

# Work finished — clear any previous in-progress handoff:
bun ~/.pal/tools/handoff-note.ts --done --title "what we completed"
```

- Write if anything is left mid-flight: unfinished implementation, open decision, partially debugged issue
- Skip if the session fully resolved everything it set out to do
- `--text` should answer: what's next, what was decided, what to watch out for

**5. Open work** — close what this session finished; open what it didn't:

**Project work** — use ISCs, not threads:
```bash
# Close completed ISCs:
bun ~/.pal/tools/project.ts complete-isc <project-name> <id>

# Open new ISCs for unfinished work:
bun ~/.pal/tools/project.ts add-isc <project-name> "what remains"
```

**Task ISA (one-shot work)** — mark complete when done:
```bash
bun ~/.pal/tools/project.ts complete-task-isa <slug>
```

**Cross-project or non-project follow-ups** — use threads:
```bash
bun ~/.pal/tools/thread.ts --add --title "brief title" --context "why it matters, what needs to happen"
bun ~/.pal/tools/thread.ts --resolve --id <id>
```

**6. Opinion capture** — scan the conversation for moments where the user:
- Confirmed something you did: "yes exactly", "keep doing that", "10 rated", accepted without pushback
- Corrected something you did: "no", "don't do that", "stop", "that's not what I meant"
- Revealed a preference by repeating a pattern (asked for concise answers twice, always checked PAI first, etc.)

For each, invoke the opinion tool:
```bash
# User confirmed a preference
bun ~/.pal/skills/opinion/tools/opinion.ts evidence "matching keywords" --confirmation "what they confirmed"

# User corrected a preference
bun ~/.pal/skills/opinion/tools/opinion.ts evidence "matching keywords" --contradiction "what they corrected"

# New pattern observed (no existing opinion matches)
bun ~/.pal/skills/opinion/tools/opinion.ts add "the preference" --category communication|technical|workflow|general
```

Skip if nothing in the conversation touched preferences or working style.

**7. Wisdom Frame** (Extended+ only) — if the session produced a genuine, reusable insight:

```bash
bun ~/.pal/tools/wisdom-frame.ts --domain <domain> --observation "insight" [--type principle|contextual-rule|anti-pattern|evolution]
```

Domains: `development`, `workflow`, `communication`, `infrastructure`, `integration`, or any fitting domain.
Only write if the insight is **genuine and reusable** — not every session produces one. When in doubt, skip.

## Output Format

```
♻️ ALGORITHM ═══════════════════════════
🗒️ TASK: [brief description]
⏱️ EFFORT: [tier] — [reason]

━━━ 👁️ OBSERVE ━━━ 1/5
🔎 REVERSE ENGINEERING:
[reverse engineering output]

🔬 CONSTRAINTS: [Extended+: EX-1, EX-2... | Standard: inline above]

📋 CRITERIA:
[criteria checklist]

🏹 CAPABILITIES: [format scales by effort level]

━━━ 🧠 PLAN ━━━ 2/5
🧠 RISKS: [risks]
🧠 PREMORTEM: [failure modes]
🧭 GROUNDING: [premises verified, or assumptions flagged]
📐 APPROACH: [execution plan]

━━━ ⚡ EXECUTE ━━━ 3/5
[work happens here]

━━━ ✅ VERIFY ━━━ 4/5
✅ VERIFICATION:
[criterion-by-criterion evidence]

🔧 CHANGE: [what changed]
🗣️ {{IDENTITY_NAME}}: [summary]

━━━ 📚 LEARN ━━━ 5/5
🪞 Q1 — Self: [what I'd do differently]
🪞 Q2 — Algorithm: [structural improvement]
🪞 Q3 — AI: [reasoning blind spot]
📊 REFLECTION LOG: [appended to algorithm-reflections.jsonl]
📝 WISDOM: [frame update if genuine insight, or "No new insight"]
```

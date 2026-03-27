# The Algorithm

Core: transition from CURRENT STATE to IDEAL STATE using verifiable criteria. Every criterion is atomic, binary testable, and checked off with evidence.

## The Five Phases

All work happens inside these phases. No work outside the phase structure until the Algorithm completes.

### ━━━ 👁️ OBSERVE ━━━ 1/5

Thinking-only. No tool calls except context recovery (Grep/Glob/Read).

**1. Reverse engineer the request:**

🔎 REVERSE ENGINEERING:
- What did they explicitly say they wanted?
- What is implied that they wanted but didn't say?
- What did they explicitly say they don't want?
- What is obvious they don't want that they didn't say?
- What are common gotchas for this type of work?

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

Output:
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
- If Advanced+ complexity, use EnterPlanMode for user alignment

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
  --q1 "self reflection" --q2 "algorithm reflection" --q3 "AI reflection"
```

**3. Open Threads** — for each unresolved question, decision, or follow-up that came up during this session:

```bash
bun ~/.pal/tools/thread.ts --add --title "brief title" --context "why it matters, what needs to happen"
```

Only add threads that genuinely need follow-up. Resolve existing threads if this session closed them:

```bash
bun ~/.pal/tools/thread.ts --resolve --id <id>
```

**4. Wisdom Frame** — if the session produced a genuine, reusable insight:

```bash
bun ~/.pal/tools/wisdom-frame.ts --domain <domain> --observation "insight" [--type principle|contextual-rule|anti-pattern|evolution]
```

Domains: `development`, `workflow`, `communication`, `infrastructure`, `integration`, or any fitting domain.
Only write if the insight is **genuine and reusable** — not every session produces one. When in doubt, skip.

## Output Format

```
♻️ ALGORITHM ═══════════════════════════
🗒️ TASK: [brief description]

━━━ 👁️ OBSERVE ━━━ 1/5
🔎 REVERSE ENGINEERING:
[reverse engineering output]

📋 CRITERIA:
[criteria checklist]

🏹 CAPABILITIES (14/14):
USE: [#, #] — [reason]
DECLINE: [#] — [reason]
N/A: [rest]

━━━ 🧠 PLAN ━━━ 2/5
🧠 RISKS: [risks]
🧠 PREMORTEM: [failure modes]
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

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

**3. Select capabilities:**

Scan the available skills listing. Select skills and tools you'll invoke during EXECUTE. Selecting a capability = commitment to invoke it via tool call. Don't select what you won't use.

Output:
```
🏹 CAPABILITIES: [list each selected skill/tool and why]
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

Reflect on the work and capture reusable knowledge. Skip this phase when the work was trivial or purely mechanical.

**1. Reflection** (one sentence each):
- What would I do differently next time?
- What would a better algorithm have done differently?

**2. Wisdom Frame** — if the session produced a genuine, reusable insight:

```bash
bun ~/.agents/PAL/tools/wisdom-frame.ts --domain <domain> --observation "insight" [--type principle|contextual-rule|anti-pattern|evolution]
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

🏹 CAPABILITIES: [selected capabilities]

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
🪞 REFLECT: [what I'd do differently]
📝 WISDOM: [frame update if genuine insight, or "No new insight"]
```

---
name: pareto-analyze
license: MIT
description: "Finds the few units that drive most of an outcome (roughly the 20% behind 80%) in any domain, from a number per unit: the slowest tests, the costliest jobs, the clients who bring most revenue, the foods behind most excess calories, the one lever that fixes most of a problem. Ranks the units with a deterministic tool, finds the trait the top units share, and proposes one structural move per top cause, then stops for approval. Use when the user asks where to focus, what to cut or fix first, which few things matter most, for an 80/20 or Pareto analysis, or for the biggest offenders or contributors behind a total. Not for a single root-cause hunt without per-unit numbers, and not for answering a health question by itself."
argument-hint: <problem or goal, and where the numbers are>
metadata:
  source: portable-agent-layer
  triggers:
    - "pareto-analyze"
    - "pareto analyze"
    - "80/20"
    - "pareto principle"
    - "biggest offenders"
    - "find the 20 percent"
    - "where to focus"
---

Find the few units that drive most of the outcome in $ARGUMENTS, so effort goes where it pays most. The result is approximate: "about 20% of the units carry about 80%" is a shape to test for, not a law. Some problems do not have it, and saying so is a valid result.

## Workflow

1. **Frame the outcome and the units.** State three things in one line each:
   - **Outcome**: the one number being analyzed, with its unit of measure (seconds, currency, kcal, failures).
   - **Direction**: more of it (revenue, sign-ups) or less of it (time, cost, failures, calories).
   - **Units**: what gets ranked. Units are one of two kinds:
     - **items** carry the measure themselves: tests, jobs, clients, endpoints, invoices.
     - **levers** contribute to the outcome: foods, habits, treatments, causes, channels.

   When the outcome is an excess over a target or plan, the value of a unit is the part that removing it would take away, not its raw total. Units that are part of the plan are not ranked.

   If the outcome or the units can be read in more than one way, ask the user once, in a single question that names your recommended default. Otherwise proceed without asking.
2. **Run the fit check.** It flags exactly one case: levers that depend on each other so much that their contributions cannot be separated (each works only together with another, or one only matters once another is in place). In that case do not rank. Tell the user which levers are entangled, name the combination as one unit if that is meaningful, and stop or continue with the separable units only.
3. **Measure before theorizing.** Get one number per unit before naming any cause. Label every number as one of two kinds:
   - **measured**: the user's own data. A command run now, a CSV or CRM export, logs, a billing report, a food or time log. Name the source and the period it covers.
   - **estimated**: an effect size from research, with the source named. For any health, medical, nutrition or exercise estimate, invoke the `scientific-research` skill and use the figures it returns; never take them from memory.

   Put all values on one scale. If estimated levers cannot be put on one scale, do not compute shares: list them in order of effect with their sources and say the shares are unknown. When a measured number and an estimated one disagree about the same unit, the measured one wins. Cover every unit, not a sample of the ones that look large; if some units could not be measured, count them and report them as unmeasured.
4. **Rank with the tool.** Write the numbers to a CSV file with one row per unit (or per observation; rows naming the same unit are summed), a value column, an `evidence` column holding `measured: <source>` or `estimated: <source>`, and no trait columns yet. Run:

   ```bash
   pal cli skill run pareto-analyze pareto <file> --unit <unit column> --value <value column>
   ```

   Take every share, cumulative share and the cut-off from its output. Do not compute or round them yourself. Read the `Shape` line:
   - `concentrated`: a third of the units or fewer reach the cut-off. Continue.
   - `weak`: between a third and a half of the units are needed. Continue, and tell the user the concentration is weak.
   - `flat`: more than half of the units are needed. Tell the user plainly that no small set drives this outcome, show the table, and skip to step 6 with no proposed moves. With fewer than five units, treat the shape label as uninformative and say so.
5. **Find what the top units share.** This is where the leverage is: one cause shared by the top units is worth more than the list of them. When the top set is a single unit, that unit is the cause: skip this step and say so in the report.
   1. Name two to five candidate traits. A trait is a fact that can be checked for a unit: "starts a subprocess", "came through referral", "eaten after 8 pm", "runs on the largest instance type".
   2. Check each trait for ALL units, top and tail, with the same check: a search over the code, a field in the export, a question to the user about the log. Never fill a trait from a unit's name or from what seems likely. Leave the cell blank when the check gives no answer.
   3. Add one column per trait to the file and run the tool once more, with one `--group-by` per trait:

      ```bash
      pal cli skill run pareto-analyze pareto <file> --unit <unit column> --value <value column> --group-by <trait> --group-by <other trait>
      ```

   4. A trait is a top cause when one of its groups holds most of the units in the top set AND a share of the total close to the cut-off. A group that holds the top units but a small share, or a large share spread over many tail units, is not one. Report the `(unknown)` and `(mixed)` shares for the trait you pick: they are the part of the outcome the cause does not explain.
   5. When no trait qualifies, say that the top units share no checked trait, and treat each top unit as its own cause.
6. **Report, then stop.** Produce the output below. Propose moves only for top causes: nothing for units or groups below the cut-off, even when a fix for them is obvious. Then stop and wait for the user's approval. Make no edit, send nothing and change nothing before it.

## The pareto tool

```bash
pal cli skill run pareto-analyze pareto <file.csv|file.json> [--unit <column>] [--value <column>] [--group-by <column>]... [--cutoff <percent>] [--limit <rows>]
```

- Input: a CSV with a header row, or a JSON array of flat objects. `--unit` defaults to a column named `unit`, `--value` to one named `value`.
- Output: a table sorted by contribution with `n` (rows summed into the unit), value, share and cumulative share; a marker on the row where the cumulative share reaches the cut-off; a `Cut-off` line with how many units that took; a `Shape` line; and one table per `--group-by` with each group's units, units in the top set, value and share, followed by the unknown share.
- `--cutoff` changes the 80% target. `--limit` sets how many unit rows are printed before the rest collapse into one row (default 30, `0` prints all).
- It refuses negative values. When an outcome has gains and losses, analyze each side in its own run.

## Output format

Return exactly these sections, in this order:

```markdown
## Pareto: <outcome>, <more of it | less of it>

**Units:** <items | levers>: <what a unit is>. **Period and source:** <what the numbers cover>.

### Ranking

| unit or cause | n | value | share | cumulative share | evidence |
|---|---|---|---|---|---|
| <rows from the tool, down to the cut-off row, then one row for the rest> |

<The tool's Cut-off and Shape lines, in one sentence.>

### What the top units share

<The trait, how it was checked for every unit, its group's row from the tool (units, units in the top set, value, share), and the unknown share. Or: "The top units share no checked trait", with the traits that were checked.>

### Weakest assumption

<The one assumption the result leans on most, and the measurement that would prove it wrong.>

### Proposed moves

1. <Top cause>: <one structural fix or move>. Expected effect: up to <the cause's measured share> of <outcome>.

Nothing has been changed. Approve a move and it will be carried out.
```

Rules for the sections:

- **Ranking**: copy numbers from the tool output. The `evidence` cell reads `measured: <source>` or `estimated: <source>`. When a shared trait was found, add the cause's group row above the unit rows.
- **Weakest assumption**: one assumption, not a list. Typical ones: the period measured is representative; the trait causes the cost instead of merely accompanying it; an estimated effect size applies to this user.
- **Proposed moves**: a numbered list with one item per top cause and no item for anything below the cut-off. A structural move removes the cause for all units that share it (a rule, a default, a change of process), as opposed to tuning units one at a time. State the expected effect as an upper bound taken from the measured share, and label it estimated when the share was estimated. With a `flat` shape, write "No move is supported by these numbers" instead of a list.
- The last line always states that nothing was changed and asks for approval.

## Worked example

A test suite is slow. Timing every test file (measured, one full run) and ranking the files shows that a small set of files holds most of the total time. Checking each file for candidate traits, the trait "starts a subprocess" is checked by searching every file for process-spawning calls, and its group holds nearly all of the top set and most of the total; directory and file size, checked in the same way, split the time evenly. The proposed move is structural, one for the one cause: a test preload that refuses any subprocess outside files with a dedicated name suffix, plus moving the spawning tests into such files, so that a fast tier can run every non-spawning test in seconds. Tuning the slow tests one by one is not proposed, and neither is anything for the slow non-spawning files below the cut-off.

## Verticals

Read the matching reference before step 3 when the problem falls in one of these domains. Each lists typical metrics, where the data comes from, typical shared traits and pitfalls.

- Software (test time, CI cost, flaky failures, latency, error logs): [references/software.md](references/software.md)
- Health (sleep, diet items, exercise and other levers): [references/health.md](references/health.md)
- Sales (revenue per client, acquisition channel, churn): [references/sales.md](references/sales.md)

For any other domain, follow the workflow as written.

## When to use

- The user asks where to focus, what to cut or fix first, or which few things matter most, and the outcome can be expressed as a number per unit.
- The user asks for an 80/20 or Pareto analysis, the biggest offenders, or the top contributors to a total.
- A total is too large or too small (suite time, cloud bill, calories, churn, revenue) and the user wants the smallest change with the largest effect.

## Do NOT use

- Finding the root cause of one failure, or decomposing a problem that has no per-unit numbers. That is the `first-principles` skill.
- Open-ended thinking, brainstorming or weighing options. That is the `think` skill.
- Diagnosing why a PAL hook, skill or automation did not fire. That is the `reflect` skill.
- Analyzing PAL's own ratings and failure patterns. That is the `pal-analyze` skill.
- Answering a health or scientific question. That is the `scientific-research` skill; this skill calls it for effect sizes and only ranks what it returns.
- Levers that cannot be separated from each other (step 2). Say so instead of ranking.
- Carrying out the fix. This skill ends at the proposal; the work starts after the user approves.

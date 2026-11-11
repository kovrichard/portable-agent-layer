---
name: scout
license: MIT
description: "Hands a simple, judgment-free search to the small-model scout subagent and acts on its report, keeping the file reads out of the main session. Use when finding where something is defined, called, configured or used, listing every occurrence of a thing, or searching files or code across several places when no judgment is needed. Not for reviews, decisions, root causes, recommendations or web research."
argument-hint: <what to find>
metadata:
  source: portable-agent-layer
  triggers:
    - "scout"
    - "send a scout"
    - "find every place"
    - "where is this used"
    - "search the codebase for"
    - "list every occurrence"
    - "find all usages"
---

# Scout

Hand the search for $ARGUMENTS to the `scout` subagent: a read-only searcher that runs on the small model of the active agent. It finds things and reports facts; it never judges, ranks or recommends. The many file reads stay in its context, and you receive only the report.

## Workflow

1. **Decide whether the search fits.** Send a scout only when all three hold:
   - The target can be stated in one sentence.
   - Finding it takes more than a few lookups: several files or many occurrences.
   - Finding it needs no judgment: where something is defined, called, configured or mentioned; which files match a pattern or contain a thing; a complete list of occurrences with stated facts about each one.

   If any of them fails, see "Do NOT use" and stop here.
2. **Write the brief** from the template below. The scout knows nothing but the brief, so put every fact it needs into it: nothing from this conversation reaches it otherwise.
3. **Start the `scout` subagent** with the agent's own delegation mechanism (in Claude Code, the Agent tool with `subagent_type: "scout"`). Pass no model override: the subagent's definition already pins the small model where the agent's config allows it. When there are several independent searches, write one brief per search and start the scouts at the same time.
4. **Read the report, closing lists first.** Read the "not determined / not read in full" list before the hits: anything listed there is unknown, not absent. Then read the "excluded" list, then the hits and the count.
5. **Act on the report.** Trust it. Do not rerun the search in the main session: that puts the file reads back into your context and removes the whole gain.
6. **Check one claim before a costly action.** Before an action where a missed hit is expensive or hard to undo (deleting code, changing a shared signature, a rename across the codebase), run one targeted check on the specific claim the action rests on. One command, never a second full search.
7. **Send a follow-up when the report is thin or wrong.** Continue the same scout with a message that names the gap ("the list has no hits under `<folder>`; search it and report in the same format"). Do not start a new scout and do not search yourself. If the second report still misses, the target needed judgment: take the search back and do it in the main session.

## The brief

A brief holds these seven parts, in this order:

1. **Goal**: one sentence.
2. **Scope**: the folders to search and what to exclude.
3. **Known forms**: every form of the target you already know (function names, command forms, constants), marked "verify, do not assume this is complete".
4. **Fields per hit**: a numbered list of the exact fields wanted, with file path and line number always first.
5. **Closing lists**: the two lists the report must end with: what the scout could not determine or did not read in full, and what looked like a hit but was excluded and why.
6. **Facts only**: the sentence "Report facts only: no opinions, no recommendations, no ranking."
7. **Count**: a request for the final number of hits.

Example, for finding every place a config key is read:

```text
Goal: find every place the config key `cache.ttl` is read.

Scope: search `src/` and `scripts/`. Exclude `node_modules/`, `dist/` and test files (`*.test.ts`).

Known forms (verify, do not assume this is complete):
- `config.get("cache.ttl")`
- `config.cache.ttl`
- the constant `CACHE_TTL_KEY`

For each hit, report:
1. File path and line number
2. The enclosing function or top-level scope
3. The form used (one of the above, or the new form you found)
4. Whether a fallback value is given on that line, and the value

End the report with two lists:
- Not determined / not read in full: anything you could not determine, and every file or folder in scope you did not read in full.
- Excluded: anything that looked like a hit but is not one, with the reason.

Report facts only: no opinions, no recommendations, no ranking.
Finish with the total number of hits.
```

## Output format

After a scout run, tell the user three things, in this order:

- **Findings**: the hits, each with its file path and line number, limited to the fields the user's question needs.
- **Count**: the total number of hits the scout reported.
- **Not read**: what the scout could not determine or did not read in full, whenever the answer depends on it. State it as unknown, never as absent.

Say when a figure comes from the scout's report and you have not checked it yourself. If you ran the one targeted check from step 6, give the command and what it showed.

## When to use

- The user asks where something is defined, called, configured or mentioned, and the answer spans several files.
- The user asks for a complete list: every occurrence, every file that matches a pattern, every caller.
- Your own task needs such a list before it can continue, and gathering it would take many file reads.

## Do NOT use

- A lookup of one or two commands whose location is already known. Run it directly.
- Anything that asks for a decision, an evaluation, a review, a ranking, a root cause or a recommendation.
- A vague target where deciding what counts is the task. Narrow it to one sentence first, or search yourself.
- Anything that writes or changes files. The scout is read-only.
- Web research. That is the `deep-research` skill.

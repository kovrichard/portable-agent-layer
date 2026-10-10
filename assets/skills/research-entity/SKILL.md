---
name: research-entity
license: MIT
description: "Research one company or person on the web and build a sourced profile: official website, LinkedIn, social accounts, the company registry entry (cégjegyzék for Hungarian companies), and recent news or statements. Use when the user asks to research, look up, profile, or background-check a specific company or person, or to enrich a knowledge-store entry."
argument-hint: <company or person name> [what you know about them]
metadata:
  source: portable-agent-layer
  triggers:
    - "research-entity"
    - "research entity"
    - "research this company"
    - "research this person"
    - "look up the company"
    - "company background"
    - "background check"
    - "cégjegyzék"
---

Research the company or person named in $ARGUMENTS and show a sourced profile. The research runs through `pal cli knowledge research`, which picks the active agent's web search and limits it to searching and reading pages. Never research with your own tools instead: the command is what keeps the result in the same shape on every agent.

## Workflow

1. Work out from $ARGUMENTS and the conversation:
   - the exact name;
   - whether it is a company or a person;
   - for a person, where they work;
   - one sentence of what the user said about them.
   If you cannot tell a company from a person, ask.
2. Run the research. For a company:
   ```bash
   pal cli knowledge research "<name>" --context "<what the user said>"
   ```
   For a person, add `--person` and, when known, `--organization "<employer>"`:
   ```bash
   pal cli knowledge research "<name>" --person --organization "<employer>" --context "<what the user said>"
   ```
   It takes one to several minutes. Add `--queue` when the user wants the profile saved; it then waits in the review queue.
3. If the command exits 1, tell the user the reason it printed. Usual reasons:
   - the model found only namesakes (`match: unsure`): ask for something that tells them apart, such as an employer, a city or a website, and run it again with that in `--context` or `--organization`;
   - nothing was found (`match: none`);
   - the active agent cannot search the web yet.
4. If it succeeds, show the profile it printed as it is. Do not add facts it did not print.
5. If you queued it, tell the user the review command it printed: `pal cli knowledge review accept <id>` writes the profile to the entry, and `pal cli knowledge review reject <id>` drops it.

## Output format

The profile as printed: summary, links, registry, news and sources. Then one line saying whether it was queued for review, with the accept command.

## When to use

- The user names a specific company or person and wants to know who they are, or their website, LinkedIn, accounts, registry data or recent news.
- The user wants an entry in the knowledge store filled in from the web.

## Do NOT use

- To pull every person and company out of an article, video or paste. Use `entities` for that.
- For a broad topic, market or question rather than one named entity. Use `deep-research` for that.

---
name: entities
description: Maintain the personal knowledge graph of people and companies. Detect named entities in any content (article, video, paste, conversation), upsert them to ~/.pal/memory/knowledge/, and surface what's already known. Use proactively whenever named entities appear — don't wait to be asked.
argument-hint: <content, URL, or pasted text>
---

Detect, persist, and query people and companies referenced in $ARGUMENTS.

The default workflow is **extract → save → show summary**, in that order. Saving is not optional: persistence is the point of the skill. Skip the save step only if the user explicitly said "don't save", "just look", or similar.

## 1. Extract

Read/fetch the content and extract ALL people and companies mentioned.

### People

For each person, extract:
- **name**: Full name
- **role**: author | subject | mentioned | quoted | expert | interviewer | interviewee
- **title**: Job title (null if unknown)
- **company**: Company affiliation (null if unknown)
- **social**: twitter (@handle), linkedin (URL), email, website — null if unknown
- **context**: Why this person is mentioned and their relevance
- **importance**: primary (central to content) | secondary (supporting) | minor (brief mention)

### Companies

For each company/organization, extract:
- **name**: Official name
- **domain**: Primary website domain (e.g. "anthropic.com", null if unknown)
- **industry**: Classification (AI, security, fintech, healthcare, etc.)
- **context**: How and why mentioned
- **mentioned_as**: subject | source | example | competitor | partner | acquisition | product | other
- **sentiment**: positive | neutral | negative | mixed

### Extraction guidelines

- Accuracy over quantity — use null for unknown fields, never guess
- Include authors, subjects, quoted individuals, and anyone significantly mentioned
- For research papers: all authors get "author" role
- For interviews: distinguish interviewer vs interviewee
- Universities and research institutions count as companies
- Extract social handles from bios, signatures, or text body
- Context fields should explain relevance, not just repeat the mention

### Output shape

```json
{
  "people": [...],
  "companies": [...]
}
```

## 2. Save (default)

Immediately persist the extracted JSON. Do not ask first — saving is the default:

```bash
echo '<the JSON output>' | pal cli knowledge ingest --source "<URL or content origin>"
```

The CLI writes one markdown file per entity under `~/.pal/memory/knowledge/{People,Companies}/<slug>.md`, preserving every extracted field (role, title, social, context, importance for people; domain, industry, sentiment, mentioned_as for companies) as frontmatter. When a person record includes a `company`, a `part-of` typed edge is auto-created from the person to the company (the company is stub-created if it doesn't exist yet). Each ingestion appends a per-source log section to the entity's body so the same source can be re-ingested safely (idempotent on `--source`).

The CLI prints a JSON summary of `{created, updated, slugs}` counts per domain.

**Opt-out:** if the user explicitly said not to save (e.g. "who's mentioned in this email — don't store anything"), skip step 2 entirely and just show the extracted JSON.

## 3. Query (read-back)

Before scraping a known source, or after saving, surface what's already on file:

```bash
pal cli knowledge search "<name>"   # substring across title, tags, body
pal cli knowledge show <slug>       # full entity (frontmatter + body)
pal cli knowledge graph <slug>      # related entities (BFS, default 2 hops)
pal cli knowledge ls People         # list a domain
pal cli knowledge stats             # counts, hubs, isolated nodes
pal cli knowledge find <tag>        # entities tagged with <tag> (topic: prefix transparent)
```

Use `search` before extracting to detect duplicates; use `show` to confirm a save landed correctly; use `graph` to surface relationships the user may have forgotten.

## Tag conventions (important)

Tags do two different jobs in the store, and PAL keeps them separated so the graph stays meaningful:

| Tag form | Purpose | Example | Generates graph edges? |
|---|---|---|---|
| `topic:<token>` | **Facet** — for filtering / `find` | `topic:ai`, `topic:consulting` | **No** — two entities sharing `topic:ai` do NOT get linked |
| Unprefixed | **Structural** — for navigation | `acme-labs`, `customer` | Yes — co-occurrence creates tag edges |

**Industry inheritance.** When ingest sees a company `industry`, it splits the string on whitespace and `/` and writes `topic:<token>` tags for each piece. When a person is linked to a company, the person inherits **only** the company's `topic:*` tags — never structural ones. This keeps `find ai` useful (it surfaces every AI-industry company + their employees) without creating phantom graph edges between unrelated entities that merely share an industry word.

Users can query with or without the prefix — `find ai` and `find topic:ai` are equivalent.

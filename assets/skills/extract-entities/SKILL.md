---
name: extract-entities
description: Extract people and companies from content (articles, videos, URLs, pasted text). Use when identifying who and what organizations are mentioned in content.
argument-hint: <content, URL, or pasted text>
---

Extract people and companies from $ARGUMENTS:

1. Read/fetch the content
2. Extract ALL people and companies mentioned

## People

For each person, extract:
- **name**: Full name
- **role**: author | subject | mentioned | quoted | expert | interviewer | interviewee
- **title**: Job title (null if unknown)
- **company**: Company affiliation (null if unknown)
- **social**: twitter (@handle), linkedin (URL), email, website — null if unknown
- **context**: Why this person is mentioned and their relevance
- **importance**: primary (central to content) | secondary (supporting) | minor (brief mention)

## Companies

For each company/organization, extract:
- **name**: Official name
- **domain**: Primary website domain (e.g. "anthropic.com", null if unknown)
- **industry**: Classification (AI, security, fintech, healthcare, etc.)
- **context**: How and why mentioned
- **mentioned_as**: subject | source | example | competitor | partner | acquisition | product | other
- **sentiment**: positive | neutral | negative | mixed

## Output

Return structured JSON:

```json
{
  "people": [...],
  "companies": [...]
}
```

## Guidelines

- Accuracy over quantity — use null for unknown fields, never guess
- Include authors, subjects, quoted individuals, and anyone significantly mentioned
- For research papers: all authors get "author" role
- For interviews: distinguish interviewer vs interviewee
- Universities and research institutions count as companies
- Extract social handles from bios, signatures, or text body
- Context fields should explain relevance, not just repeat the mention

## Persistence

After displaying results, ask the user if they want to save. When saving, pipe the JSON output through the entity-save tool which handles deduplication automatically:

```bash
echo '<the JSON output>' | bun ~/.pal/skills/extract-entities/tools/entity-save.ts -- --source "<URL or content origin>"
```

The tool deduplicates against the entity index (`memory/entities/entity-index.json`), assigns stable UUIDs, tracks occurrences, and reports what was new vs existing.

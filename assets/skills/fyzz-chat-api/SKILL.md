---
name: fyzz-chat-api
description: Query Fyzz Chat conversations and projects via the REST API. Use when looking up conversations, searching chat history, or listing projects in Fyzz Chat.
argument-hint: <conversations|projects> [options]
---

When you need to access the user's Fyzz Chat conversations or projects, use the `fyzz-api` CLI tool. The tool reads the API key from the `FYZZ_API_KEY` environment variable automatically — never attempt to read, print, or reference the API key or the env var directly.

## Available commands

### List conversations

```bash
bun ~/.agents/skills/fyzz-chat-api/tools/fyzz-api.ts -- conversations [--limit 20] [--search "query"] [--project-id <id>] [--cursor <cursor>]
```

### Get a single conversation with messages

```bash
bun ~/.agents/skills/fyzz-chat-api/tools/fyzz-api.ts -- conversations <conversation-id>
```

### List projects

```bash
bun ~/.agents/skills/fyzz-chat-api/tools/fyzz-api.ts -- projects
```

## Setup

If the tool reports a missing API key:

1. Ask the user to create one in Fyzz Chat → Settings → API Keys
2. They should set `FYZZ_API_KEY` in their shell profile or in PAL's `settings.json` env section
3. Optionally set `FYZZ_BASE_URL` (defaults to `http://localhost:3000`)

## Guidelines

- The API key is never visible in this conversation — that is by design
- Use `--search` for keyword-based lookup across titles and message content
- Use `--project-id` to scope results to a specific project
- Paginate with `--cursor` using the cursor from the previous response's `meta.cursor` field
- For large conversations, consider whether you need all messages or just the metadata (list mode returns titles only)

# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| Latest stable release (`latest` on npm) | Yes |
| Latest canary (`canary` on npm) | Yes |
| Anything older | No — update with `pal cli update` |

## Reporting a vulnerability

Please report privately through
[GitHub's private vulnerability reporting](https://github.com/kovrichard/portable-agent-layer/security/advisories/new),
not in a public issue.

Include the PAL version (`pal cli status`), the agent (Claude Code, opencode,
Cursor, Copilot, Codex, Antigravity CLI), your OS, and steps to reproduce.

You can expect an acknowledgement within 7 days and a fix or a decision
within 30 days. Fixes ship as a canary first, then in the next stable release.

## Scope

PAL runs hooks inside your coding agents and stores your context locally, so
these count as security issues:

- a way around the security hook (`src/hooks/lib/security.ts`), for example
  a command it should block but lets through
- secrets from `~/.pal/.env` or your environment reaching logs, the event
  log, exports or a model prompt
- a skill, hook or `pal cli` command that runs something the user did not ask for
- the dark-factory plugin pushing, merging or deleting without the user

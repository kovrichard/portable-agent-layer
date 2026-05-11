# Work Tracking

PAL tracks your work across sessions in `memory/state/sessions.json` (auto-captured).

## Projects

Projects are managed via the `/projects` skill. State lives in `~/.pal/memory/state/progress/{slug}.json`, one file per project. Inspect with `bun ~/.pal/tools/project.ts list`; manage via `~/.pal/docs/PROJECT_LIFECYCLE.md`.

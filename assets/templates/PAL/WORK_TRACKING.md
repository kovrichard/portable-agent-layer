# Work Tracking

PAL tracks your work across sessions in `memory/state/sessions.json` (auto-captured) and `memory/state/projects.json` (AI-managed).

## Projects

Update `projects.json` via the work-tracking library when:
- **Starting sustained multi-session work** → create a project with objectives and an id (slugified, e.g. "pdf-template-engine")
- **Making a key decision** → add to the project's `decisions` array
- **Completing a milestone** → add to `completed`, remove from `nextSteps`
- **Session ends with open work** → update `nextSteps` and `handoff`
- **Work is done** → set status to "completed"

Do not create projects for one-off questions or quick fixes.

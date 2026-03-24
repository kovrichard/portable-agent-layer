# Opinion Tracking

PAL tracks confidence-scored opinions about the user. When you notice the user confirming or contradicting a behavioral pattern, update it via `bun run tool:opinion`. Run `bun run tool:opinion -- --help` for full usage and examples. Opinions at ≥85% confidence are automatically injected into every session context.

import type { Plugin } from "@opencode-ai/plugin";

// opencode plugin — runs lint, format, type-check, and knip when the session
// goes idle (= the agent stops generating). Mirrors the Claude Code Stop hook
// and the Cursor stop hook so the same gate applies in every agent.
export const LintPlugin: Plugin = async ({ $ }) => {
  return {
    "session.idle": async () => {
      await $`bun run check`;
      await $`bun run type-check`;
      await $`bun run knip`;
      await $`bun run jscpd`;
      await $`bun klint/cli.ts --json`;
      await $`bun run madge`;
      await $`bun run lf`;
      await $`bun run secretlint`;
    },
  };
};

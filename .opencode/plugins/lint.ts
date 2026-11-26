import type { Plugin } from "@opencode-ai/plugin";

export const LintPlugin: Plugin = async ({ $ }) => {
  return {
    "session.idle": async () => {
      await $`bun run gates`;
    },
  };
};

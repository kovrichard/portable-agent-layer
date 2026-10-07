import { resolve } from "node:path";

const CONTEXT_RULE_AGENT_DIRS = [
  "PAL_CURSOR_DIR",
  "PAL_COPILOT_DIR",
  "PAL_GEMINI_DIR",
] as const;

/**
 * The stop handlers copy context digests into every installed agent's home, so a
 * test that runs them with only PAL_HOME sandboxed overwrites the developer's
 * real Cursor, Copilot and Antigravity rules. Returns the restorer.
 */
export function sandboxContextRuleDirs(root: string): () => void {
  const saved = CONTEXT_RULE_AGENT_DIRS.map((v) => process.env[v]);
  for (const v of CONTEXT_RULE_AGENT_DIRS) process.env[v] = resolve(root, v);
  return () =>
    CONTEXT_RULE_AGENT_DIRS.forEach((v, i) => {
      const value = saved[i];
      if (value === undefined) delete process.env[v];
      else process.env[v] = value;
    });
}

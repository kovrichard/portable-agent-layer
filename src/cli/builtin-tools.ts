/**
 * PAL's own agent tools, surfaced as `pal cli <verb>`.
 *
 * Instruction text names the verb rather than `bun ~/.pal/tools/<tool>.ts`, so
 * no shell has to expand a tilde — which cmd.exe never does and PowerShell
 * passes through literally — and a tool can move without breaking every doc
 * that calls it. Each entry imports lazily, so an unused verb costs nothing.
 */
const BUILTIN_TOOLS = {
  "algorithm-reflect": () => import("../tools/agent/algorithm-reflect"),
  "algorithm-synthesize": () => import("../tools/agent/algorithm-synthesize"),
  analyze: () => import("../tools/agent/analyze"),
  "handoff-note": () => import("../tools/agent/handoff-note"),
  project: () => import("../tools/agent/project"),
  "relationship-note": () => import("../tools/agent/relationship-note"),
  synthesize: () => import("../tools/agent/synthesize"),
  thread: () => import("../tools/agent/thread"),
  "wisdom-frame": () => import("../tools/agent/wisdom-frame"),
} satisfies Record<string, () => Promise<{ run: (argv: string[]) => unknown }>>;

export const builtinToolVerbs = Object.keys(BUILTIN_TOOLS).sort();

/** Dispatch a built-in verb; false means the command belongs to the main switch. */
export async function runBuiltinTool(command: string, args: string[]): Promise<boolean> {
  const load = BUILTIN_TOOLS[command as keyof typeof BUILTIN_TOOLS];
  if (!load) return false;
  const { run } = await load();
  await run(args);
  return true;
}

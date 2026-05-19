/**
 * Spawn-guard — prevents PAL inference recursion.
 *
 * When the inference dispatcher (see src/hooks/lib/inference.ts) spawns an
 * agent CLI (claude --print, codex exec, copilot -p, cursor-agent -p) for
 * one-shot subscription-billed inference, it sets PAL_SPAWNED_INFERENCE=1
 * and increments PAL_INFERENCE_DEPTH. PAL's own hooks check these on entry
 * and short-circuit so the spawned subprocess does not itself trigger another
 * inference call → infinite recursion.
 *
 * PRIMARY DEFENSE: per-agent CLI flags that disable hook loading in the
 * spawned subprocess. PAI's canonical pattern (PAI/TOOLS/Inference.ts):
 *   --setting-sources ''    → no settings.json → no hooks load
 *   --tools ''              → no tool calls → no PreToolUse triggers
 *   --system-prompt <x>     → explicit prompt instead of loaded default
 * The dispatcher in step 3 must mirror this per supported agent.
 *
 * SECONDARY DEFENSE (this file): an env-var sentinel that survives across
 * spawn boundaries. Catches cases where (a) we get a CLI flag wrong, (b) an
 * agent CLI does not expose clean equivalents to claude's flags, (c) the
 * environment leaks unexpectedly. Belt and suspenders.
 */

export const SPAWN_GUARD_ENV = {
  /** Set to "1" by the dispatcher before spawning. Checked by every PAL hook. */
  SENTINEL: "PAL_SPAWNED_INFERENCE",
  /** Stringified integer. Incremented by the dispatcher; absent = 0. */
  DEPTH: "PAL_INFERENCE_DEPTH",
  /** Hard cap. Dispatcher MUST refuse to spawn when current depth >= MAX_DEPTH. */
  MAX_DEPTH: 1,
} as const;

/** True when the current process is a PAL-spawned inference subprocess. */
export function isPalSpawnedInference(): boolean {
  return process.env[SPAWN_GUARD_ENV.SENTINEL] === "1";
}

/** How many PAL inference spawns deep we are. 0 = top-level user session. */
export function getInferenceDepth(): number {
  const raw = process.env[SPAWN_GUARD_ENV.DEPTH];
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Build the env mutation a dispatcher applies before spawn. Increments depth.
 * Returns an object suitable for merging into `spawn`'s env option.
 */
export function buildSpawnGuardEnv(parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const nextDepth = getInferenceDepthFrom(parentEnv) + 1;
  return {
    ...parentEnv,
    [SPAWN_GUARD_ENV.SENTINEL]: "1",
    [SPAWN_GUARD_ENV.DEPTH]: String(nextDepth),
  };
}

function getInferenceDepthFrom(env: NodeJS.ProcessEnv): number {
  const raw = env[SPAWN_GUARD_ENV.DEPTH];
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

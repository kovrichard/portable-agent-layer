/**
 * Inference dispatcher.
 *
 * Public entry: `inference(opts)`. Internally routes to the best available path
 * based on the active agent, claude-binary availability, and recursion depth.
 *
 * Routing order (first match wins):
 *   1. depth >= MAX_DEPTH         → refuse (prevents recursion if env leaks)
 *   2. isClaude() + claude on PATH → inferenceViaClaudeSpawn (subscription-billed)
 *   3. hasApiKey()                 → inferenceViaApi (current Anthropic API path)
 *   4. otherwise                   → { success: false }
 *
 * The claude-spawn path mirrors PAI/TOOLS/Inference.ts in spawn args:
 *   --print --tools '' --setting-sources '' --output-format json --system-prompt …
 * These flags prevent the spawned subprocess from loading PAL hooks or making
 * tool calls — the primary recursion defense. PAL's spawn-guard env sentinel
 * is the secondary belt-and-suspenders layer (see lib/spawn-guard.ts).
 *
 * Other-agent dispatchers (codex exec, copilot -p, cursor-agent -p) are not
 * yet wired and currently fall through to the API path.
 */

import { z } from "zod";
import {
  getActiveAgent,
  isAntigravity,
  isClaude,
  isCodex,
  isCopilot,
  isCursor,
  isOpencode,
} from "./agent";
import {
  buildCodexArgs,
  buildCursorArgs,
  CODEX_REPLY,
  inferenceViaAntigravitySpawn,
  inferenceViaClaudeSpawn,
  inferenceViaCopilotSpawn,
  inferenceViaOpencodeSpawn,
} from "./inference-agents";
import { inferenceViaApi, inferenceViaOpenAiApi } from "./inference-api";
import {
  getAntigravityBinary,
  getClaudeBinary,
  getCodexBinary,
  getCopilotBinary,
  getCursorBinary,
  getOpencodeBinary,
  hasAntigravityBinary,
  hasClaudeBinary,
  hasCodexBinary,
  hasCopilotBinary,
  hasCursorBinary,
  hasOpencodeBinary,
} from "./inference-binaries";
import { logInferenceCall, SCHEMA_MISMATCH } from "./inference-events";
import { buildCliPrompt, parseJsonFromOutput } from "./inference-prompt";
import { inferenceViaCliSpawn } from "./inference-spawn";
import { type InferenceOptions, type InferenceResult, modelFor } from "./inference-types";
import { logDebug, logError } from "./log";
import {
  type FixedModelRoute,
  type InferenceTier,
  inferenceModel,
  isFixedModelRoute,
} from "./models";
import { opencodeTierModel } from "./opencode-config";
import { withPalEnv } from "./pal-env";
import { getInferenceDepth, SPAWN_GUARD_ENV } from "./spawn-guard";

export function hasApiKey(): boolean {
  return !!withPalEnv().PAL_ANTHROPIC_API_KEY;
}

export function hasOpenAiKey(): boolean {
  return !!withPalEnv().PAL_OPENAI_API_KEY;
}

type InferenceRoute =
  | FixedModelRoute
  | "opencode-spawn"
  | "copilot-spawn"
  | "cursor-spawn"
  | "disabled"
  | "none";

interface RoutePreview {
  agent: string;
  route: InferenceRoute;
  reason: string;
}

function smallModelOf(route: InferenceRoute): string | undefined {
  if (route === "opencode-spawn") return opencodeTierModel("small") ?? undefined;

  return isFixedModelRoute(route) ? inferenceModel(route, "small") : undefined;
}

/**
 * Preview what `inference()` would do RIGHT NOW given current env + binaries.
 * Pure diagnostic — never spawns or fetches. Used by `pal cli doctor`.
 */
export function previewInferenceRoute(): RoutePreview & { model?: string } {
  const preview = previewRoute();

  return { ...preview, model: smallModelOf(preview.route) };
}

function nativeRoutePreview(agent: RoutePreview["agent"]): RoutePreview | null {
  if (isClaude() && hasClaudeBinary())
    return { agent, route: "claude-spawn", reason: "claude binary on PATH" };

  if (isCodex() && hasCodexBinary())
    return { agent, route: "codex-spawn", reason: "codex binary on PATH" };

  if (isCodex() && hasOpenAiKey())
    return {
      agent,
      route: "openai-api",
      reason: "codex agent without codex binary; PAL_OPENAI_API_KEY set",
    };

  if (isOpencode() && hasOpencodeBinary())
    return { agent, route: "opencode-spawn", reason: "opencode binary on PATH" };

  if (isCopilot() && hasCopilotBinary())
    return { agent, route: "copilot-spawn", reason: "copilot binary on PATH" };

  if (isCursor() && hasCursorBinary())
    return { agent, route: "cursor-spawn", reason: "cursor-agent binary on PATH" };

  if (isAntigravity() && hasAntigravityBinary())
    return { agent, route: "antigravity-spawn", reason: "agy binary on PATH" };

  return null;
}

function previewRoute(): RoutePreview {
  const agent = getActiveAgent();

  if (process.env.PAL_INFERENCE_DISABLED === "1") {
    return {
      agent,
      route: "disabled",
      reason: "PAL_INFERENCE_DISABLED=1 (test kill-switch)",
    };
  }

  const native = nativeRoutePreview(agent);
  if (native) return native;

  if (hasApiKey())
    return {
      agent,
      route: "anthropic-api",
      reason: "fallback — PAL_ANTHROPIC_API_KEY set",
    };

  return {
    agent,
    route: "none",
    reason:
      "no native CLI binary for active agent and no PAL_ANTHROPIC_API_KEY/PAL_OPENAI_API_KEY",
  };
}

/** Routes whose CLI can be limited to web search and fetch alone. */
function canSearchWeb(): boolean {
  if (isClaude() && hasClaudeBinary()) return true;

  if (isCodex() && hasCodexBinary()) return true;

  return isCopilot() && hasCopilotBinary();
}

/** True if any inference path is currently usable (subscription CLI OR API key). */
export function canInfer(): boolean {
  if (isClaude() && hasClaudeBinary()) return true;

  if (isCodex() && hasCodexBinary()) return true;

  if (isCodex() && hasOpenAiKey()) return true;

  if (isOpencode() && hasOpencodeBinary()) return true;

  if (isCopilot() && hasCopilotBinary()) return true;

  if (isCursor() && hasCursorBinary()) return true;

  if (isAntigravity() && hasAntigravityBinary()) return true;

  return hasApiKey();
}

function schemaProblem(
  output: string,
  schema: Record<string, unknown>
): string | undefined {
  const checked = z.fromJSONSchema(schema).safeParse(parseJsonFromOutput(output));
  if (checked.success) return undefined;

  return checked.error.issues
    .map((issue) => `${issue.path.join(".") || "reply"}: ${issue.message}`)
    .join("; ");
}

function plannedRoute(opts: InferenceOptions): { route: string; model: string | null } {
  const { route } = previewRoute();
  if (route === "opencode-spawn")
    return { route, model: opencodeTierModel(opts.tier ?? "small") };

  if (isFixedModelRoute(route)) return { route, model: modelFor(route, opts) };

  return { route, model: null };
}

export function plannedInferenceRoute(
  tier: InferenceTier,
  caller?: string
): { agent: string; route: string; model: string | null } {
  return { agent: previewRoute().agent, ...plannedRoute({ user: "", tier, caller }) };
}

function routeWithModel(
  opts: InferenceOptions
): ReturnType<typeof plannedRoute> | { error: string } {
  try {
    return plannedRoute(opts);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function inference(opts: InferenceOptions): Promise<InferenceResult> {
  const planned = routeWithModel(opts);
  if ("error" in planned) return { success: false, error: planned.error };
  const started = performance.now();
  const result = await checkedInference(opts);
  logInferenceCall(opts, planned, result, performance.now() - started);

  return { ...result, model: planned.model ?? undefined };
}

async function checkedInference(opts: InferenceOptions): Promise<InferenceResult> {
  const result = await routeInference(opts);
  if (!opts.jsonSchema || !result.success || !result.output) return result;
  const problem = schemaProblem(result.output, opts.jsonSchema);
  if (!problem) return result;
  logError(
    "inference",
    `caller=${opts.caller ?? "anonymous"} schema mismatch: ${problem}`
  );

  return {
    ...result,
    success: false,
    error: `${SCHEMA_MISMATCH}: ${problem}`,
  };
}

type RunInference = () => Promise<InferenceResult>;

interface RouteCandidate {
  name: string;
  modelRoute?: FixedModelRoute;
  pick: (opts: InferenceOptions) => RunInference | null;
}

function spawnRoute(
  name: string,
  isActive: () => boolean,
  binary: () => string | null,
  run: (bin: string, opts: InferenceOptions) => Promise<InferenceResult>,
  modelRoute?: FixedModelRoute
): RouteCandidate {
  return {
    name,
    modelRoute,
    pick: (opts) => {
      if (!isActive()) return null;
      const bin = binary();

      return bin ? () => run(bin, opts) : null;
    },
  };
}

function keyRoute(
  name: string,
  isReady: () => boolean,
  run: (opts: InferenceOptions) => Promise<InferenceResult>
): RouteCandidate {
  return { name, pick: (opts) => (isReady() ? () => run(opts) : null) };
}

/** First match wins, so the order is the routing priority. */
const INFERENCE_ROUTES: RouteCandidate[] = [
  spawnRoute(
    "claude-spawn",
    isClaude,
    getClaudeBinary,
    inferenceViaClaudeSpawn,
    "claude-spawn"
  ),
  spawnRoute("codex-spawn", isCodex, getCodexBinary, (bin, opts) =>
    inferenceViaCliSpawn(
      bin,
      buildCodexArgs(opts),
      buildCliPrompt(opts),
      opts,
      CODEX_REPLY
    )
  ),
  keyRoute("openai-api", () => isCodex() && hasOpenAiKey(), inferenceViaOpenAiApi),
  spawnRoute("opencode-spawn", isOpencode, getOpencodeBinary, inferenceViaOpencodeSpawn),
  spawnRoute("copilot-spawn", isCopilot, getCopilotBinary, inferenceViaCopilotSpawn),
  spawnRoute("cursor-spawn", isCursor, getCursorBinary, (bin, opts) =>
    inferenceViaCliSpawn(bin, buildCursorArgs(opts), buildCliPrompt(opts), opts)
  ),
  spawnRoute(
    "antigravity-spawn",
    isAntigravity,
    getAntigravityBinary,
    inferenceViaAntigravitySpawn,
    "antigravity-spawn"
  ),
  keyRoute("anthropic-api", hasApiKey, inferenceViaApi),
];

async function routeInference(opts: InferenceOptions): Promise<InferenceResult> {
  // Hard kill-switch — set by the test suite to guarantee no real inference
  // ever fires from tests (no spawn, no API call). Production code never sets it.
  if (process.env.PAL_INFERENCE_DISABLED === "1") {
    return { success: false };
  }

  const depth = getInferenceDepth();
  if (depth >= SPAWN_GUARD_ENV.MAX_DEPTH) {
    logDebug("inference", `refuse: depth=${depth} >= max=${SPAWN_GUARD_ENV.MAX_DEPTH}`);

    return { success: false };
  }

  const agent = getActiveAgent();
  const caller = opts.caller ?? "anonymous";
  const session = opts.sessionId ?? "-";
  const tag = `caller=${caller} sessionId=${session}`;

  if (opts.web && !canSearchWeb()) {
    logDebug("inference", `${tag} refuse: no web route agent=${agent}`);

    return { success: false, error: `web research is not available on ${agent} yet` };
  }

  for (const route of INFERENCE_ROUTES) {
    const run = route.pick(opts);
    if (!run) continue;
    const model = route.modelRoute ? ` model=${modelFor(route.modelRoute, opts)}` : "";
    logDebug("inference", `${tag} route=${route.name} agent=${agent}${model}`);

    return run();
  }

  logDebug(
    "inference",
    `${tag} route=none agent=${agent} hasApiKey=false hasOpenAiKey=${hasOpenAiKey()} hasClaude=${hasClaudeBinary()} hasCodex=${hasCodexBinary()} hasOpencode=${hasOpencodeBinary()} hasCopilot=${hasCopilotBinary()} hasCursor=${hasCursorBinary()} hasAgy=${hasAntigravityBinary()}`
  );

  return { success: false };
}

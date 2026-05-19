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
 *   --print --tools '' --setting-sources '' --output-format text --system-prompt …
 * These flags prevent the spawned subprocess from loading PAL hooks or making
 * tool calls — the primary recursion defense. PAL's spawn-guard env sentinel
 * is the secondary belt-and-suspenders layer (see lib/spawn-guard.ts).
 *
 * Other-agent dispatchers (codex exec, copilot -p, cursor-agent -p) are not
 * yet wired and currently fall through to the API path.
 */

import { spawnSync } from "node:child_process";
import { getActiveAgent, isClaude } from "./agent";
import { logDebug } from "./log";
import { HAIKU_MODEL } from "./models";
import { buildSpawnGuardEnv, getInferenceDepth, SPAWN_GUARD_ENV } from "./spawn-guard";

export function hasApiKey(): boolean {
  return !!process.env.PAL_ANTHROPIC_API_KEY;
}

/** True if any inference path is currently usable (claude-spawn OR API key). */
export function canInfer(): boolean {
  if (hasClaudeBinary() && isClaude()) return true;
  return hasApiKey();
}

interface InferenceOptions {
  system?: string;
  user: string;
  model?: string;
  maxTokens?: number;
  timeout?: number;
  /** JSON schema for structured output — guarantees valid JSON matching the schema */
  jsonSchema?: Record<string, unknown>;
}

interface InferenceResult {
  success: boolean;
  output?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export async function inference(opts: InferenceOptions): Promise<InferenceResult> {
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
  if (isClaude() && hasClaudeBinary()) {
    logDebug(
      "inference",
      `route=claude-spawn agent=${agent} model=${opts.model ?? HAIKU_MODEL}`
    );
    return inferenceViaClaudeSpawn(opts);
  }
  if (hasApiKey()) {
    logDebug(
      "inference",
      `route=api agent=${agent} reason=${isClaude() ? "no-claude-binary" : "non-claude-agent"}`
    );
    return inferenceViaApi(opts);
  }
  logDebug(
    "inference",
    `route=none agent=${agent} hasApiKey=false hasClaude=${hasClaudeBinary()}`
  );
  return { success: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// claude-spawn path — subscription-billed via the user's logged-in CLI
// ─────────────────────────────────────────────────────────────────────────────

let claudeBinaryCache: boolean | null = null;

function hasClaudeBinary(): boolean {
  if (claudeBinaryCache !== null) return claudeBinaryCache;
  const r = spawnSync("which", ["claude"], { stdio: "ignore" });
  claudeBinaryCache = r.status === 0;
  return claudeBinaryCache;
}

/** Test-only: reset the cached `which claude` result. */
export function _resetClaudeBinaryCache(): void {
  claudeBinaryCache = null;
}

/** Build the argv for `claude --print …` from inference options. Pure. */
export function buildClaudeArgs(opts: InferenceOptions): string[] {
  const model = opts.model ?? HAIKU_MODEL;
  const system = opts.jsonSchema
    ? injectJsonSchemaInstruction(opts.system ?? "", opts.jsonSchema)
    : opts.system;
  const args = [
    "--print",
    "--model",
    model,
    "--tools",
    "",
    "--output-format",
    "text",
    "--setting-sources",
    "",
  ];
  if (system) {
    args.push("--system-prompt", system);
  }
  return args;
}

/** Append a JSON-schema instruction to the system prompt (PAI pattern). */
export function injectJsonSchemaInstruction(
  systemPrompt: string,
  schema: Record<string, unknown>
): string {
  const schemaLine = `Respond with ONLY a JSON value matching this schema (no prose, no markdown): ${JSON.stringify(schema)}`;
  return systemPrompt ? `${systemPrompt}\n\n${schemaLine}` : schemaLine;
}

/** Extract a JSON object or array from raw text output. Returns null on failure. */
export function parseJsonFromOutput(output: string): unknown | null {
  const objectMatch = /\{[\s\S]*\}/.exec(output);
  const arrayMatch = /\[[\s\S]*\]/.exec(output);
  for (const candidate of [objectMatch?.[0], arrayMatch?.[0]]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      /* try next */
    }
  }
  return null;
}

async function inferenceViaClaudeSpawn(opts: InferenceOptions): Promise<InferenceResult> {
  const timeout = opts.timeout ?? 15000;
  const args = buildClaudeArgs(opts);
  const env = buildSpawnGuardEnv(process.env);
  const started = Date.now();

  return new Promise<InferenceResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: InferenceResult) => {
      if (settled) return;
      settled = true;
      logDebug(
        "inference:spawn",
        `done success=${result.success} bytes=${result.output?.length ?? 0} elapsedMs=${Date.now() - started}`
      );
      resolve(result);
    };

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(["claude", ...args], {
        env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err) {
      void logError("inference:spawn", err);
      finish({ success: false });
      return;
    }

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      void logError("inference:spawn", `timeout after ${timeout}ms`);
      finish({ success: false });
    }, timeout);

    const stdinWriter = proc.stdin as {
      write: (s: string) => void;
      end: () => void;
      close?: () => void;
    } | null;
    if (stdinWriter) {
      try {
        stdinWriter.write(opts.user);
        stdinWriter.end();
      } catch (err) {
        void logError("inference:stdin", err);
      }
    }

    void (async () => {
      const stdoutStream = proc.stdout as ReadableStream<Uint8Array> | null;
      const stderrStream = proc.stderr as ReadableStream<Uint8Array> | null;
      try {
        if (stdoutStream) stdout = await new Response(stdoutStream).text();
      } catch {
        /* ignore */
      }
      try {
        if (stderrStream) stderr = await new Response(stderrStream).text();
      } catch {
        /* ignore */
      }
      await proc.exited;
      clearTimeout(timer);
      const code = proc.exitCode;
      if (code !== 0) {
        void logError(
          "inference:spawn",
          `claude exited ${code}: ${stderr.slice(0, 200)}`
        );
        finish({ success: false });
        return;
      }
      const text = stdout.trim();
      if (!text) {
        finish({ success: false });
        return;
      }
      if (opts.jsonSchema) {
        const parsed = parseJsonFromOutput(text);
        if (parsed === null) {
          finish({ success: false, output: text });
          return;
        }
        finish({ success: true, output: JSON.stringify(parsed) });
        return;
      }
      finish({ success: true, output: text });
    })();
  });
}

async function logError(scope: string, err: unknown): Promise<void> {
  const { logError: log } = await import("./log");
  log(scope, err);
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic API path — used when no claude binary is available, or when the
// active agent is not claude. Preserves the original PAL inference behavior.
// ─────────────────────────────────────────────────────────────────────────────

async function inferenceViaApi(opts: InferenceOptions): Promise<InferenceResult> {
  const apiKey = process.env.PAL_ANTHROPIC_API_KEY;
  if (!apiKey) return { success: false };

  const {
    system,
    user,
    model = HAIKU_MODEL,
    maxTokens = 200,
    timeout = 5000,
    jsonSchema,
  } = opts;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: user }],
    };
    if (system) body.system = system;
    if (jsonSchema) {
      body.output_config = {
        format: { type: "json_schema", schema: jsonSchema },
      };
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      await logError("inference", `HTTP ${response.status}: ${errBody.slice(0, 200)}`);
      return { success: false };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const rawUsage = data?.usage as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    const usage =
      rawUsage?.input_tokens != null && rawUsage?.output_tokens != null
        ? { inputTokens: rawUsage.input_tokens, outputTokens: rawUsage.output_tokens }
        : undefined;

    const content = data?.content as Array<{ text?: string }> | undefined;
    const text = content?.[0]?.text?.trim();
    if (!text) return { success: false, usage };

    return { success: true, output: text, usage };
  } catch (err) {
    await logError("inference", err);
    return { success: false };
  }
}

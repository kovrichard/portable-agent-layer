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

import { accessSync, constants, existsSync } from "node:fs";
import { basename, delimiter, resolve as resolvePath } from "node:path";
import {
  getActiveAgent,
  isClaude,
  isCodex,
  isCopilot,
  isCursor,
  isOpencode,
} from "./agent";
import { logDebug } from "./log";
import { HAIKU_MODEL } from "./models";
import { buildSpawnGuardEnv, getInferenceDepth, SPAWN_GUARD_ENV } from "./spawn-guard";

export function hasApiKey(): boolean {
  return !!process.env.PAL_ANTHROPIC_API_KEY;
}

export function hasOpenAiKey(): boolean {
  return !!process.env.PAL_OPENAI_API_KEY;
}

/**
 * Preview what `inference()` would do RIGHT NOW given current env + binaries.
 * Pure diagnostic — never spawns or fetches. Used by `pal cli doctor`.
 */
export function previewInferenceRoute(): {
  agent: string;
  route:
    | "claude-spawn"
    | "codex-spawn"
    | "openai-api"
    | "opencode-spawn"
    | "copilot-spawn"
    | "cursor-spawn"
    | "anthropic-api"
    | "disabled"
    | "none";
  reason: string;
} {
  const agent = getActiveAgent();
  if (process.env.PAL_INFERENCE_DISABLED === "1") {
    return {
      agent,
      route: "disabled",
      reason: "PAL_INFERENCE_DISABLED=1 (test kill-switch)",
    };
  }
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

/** True if any inference path is currently usable (subscription CLI OR API key). */
export function canInfer(): boolean {
  if (isClaude() && hasClaudeBinary()) return true;
  if (isCodex() && hasCodexBinary()) return true;
  if (isCodex() && hasOpenAiKey()) return true;
  if (isOpencode() && hasOpencodeBinary()) return true;
  if (isCopilot() && hasCopilotBinary()) return true;
  if (isCursor() && hasCursorBinary()) return true;
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
  /** Opaque label identifying the calling handler — appears in debug logs as caller=X */
  caller?: string;
  /** Session ID the call is associated with — appears in debug logs as sessionId=X */
  sessionId?: string;
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
  const caller = opts.caller ?? "anonymous";
  const session = opts.sessionId ?? "-";
  const tag = `caller=${caller} sessionId=${session}`;
  if (isClaude()) {
    const bin = getClaudeBinary();
    if (bin) {
      logDebug(
        "inference",
        `${tag} route=claude-spawn agent=${agent} model=${opts.model ?? HAIKU_MODEL}`
      );
      return inferenceViaCliSpawn(bin, buildClaudeArgs(opts), opts.user, opts);
    }
  }
  if (isCodex()) {
    const bin = getCodexBinary();
    if (bin) {
      logDebug("inference", `${tag} route=codex-spawn agent=${agent}`);
      return inferenceViaCliSpawn(bin, buildCodexArgs(opts), "", opts);
    }
  }
  if (isCodex() && hasOpenAiKey()) {
    logDebug("inference", `${tag} route=openai-api agent=${agent}`);
    return inferenceViaOpenAiApi(opts);
  }
  if (isOpencode()) {
    const bin = getOpencodeBinary();
    if (bin) {
      logDebug("inference", `${tag} route=opencode-spawn agent=${agent}`);
      return inferenceViaCliSpawn(
        bin,
        buildOpencodeArgs(opts),
        "",
        opts,
        extractOpencodeText
      );
    }
  }
  if (isCopilot()) {
    const bin = getCopilotBinary();
    if (bin) {
      logDebug("inference", `${tag} route=copilot-spawn agent=${agent}`);
      return inferenceViaCliSpawn(bin, buildCopilotArgs(opts), "", opts);
    }
  }
  if (isCursor()) {
    const bin = getCursorBinary();
    if (bin) {
      logDebug("inference", `${tag} route=cursor-spawn agent=${agent}`);
      return inferenceViaCliSpawn(bin, buildCursorArgs(opts), "", opts);
    }
  }
  if (hasApiKey()) {
    logDebug("inference", `${tag} route=anthropic-api agent=${agent}`);
    return inferenceViaApi(opts);
  }
  logDebug(
    "inference",
    `${tag} route=none agent=${agent} hasApiKey=false hasOpenAiKey=${hasOpenAiKey()} hasClaude=${hasClaudeBinary()} hasCodex=${hasCodexBinary()} hasOpencode=${hasOpencodeBinary()} hasCopilot=${hasCopilotBinary()} hasCursor=${hasCursorBinary()}`
  );
  return { success: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-agent CLI metadata — binary presence + argv builders
// ─────────────────────────────────────────────────────────────────────────────

let claudeBinaryCache: string | null | undefined;
let codexBinaryCache: string | null | undefined;
let opencodeBinaryCache: string | null | undefined;
let copilotBinaryCache: string | null | undefined;
let cursorBinaryCache: string | null | undefined;

/**
 * Resolve a binary on PATH to its full absolute path.
 *
 * Manual PATH walk (instead of Bun.which / `which` subprocess) because:
 * 1. Ubuntu 24.04 dropped the `which` binary entirely.
 * 2. Windows has no `which` at all.
 * 3. Bun.which snapshots PATH at startup and ignores mid-test mutations.
 * 4. Bun.spawn on Windows is inconsistent at resolving PATHEXT for bare
 *    names — passing the full `.cmd`/`.exe` path bypasses that fragility.
 *
 * Returns the resolved absolute path or null.
 */
function findBinaryOnPath(name: string): string | null {
  const PATH = process.env.PATH;
  if (!PATH) return null;
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];
  for (const dir of PATH.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = resolvePath(dir, name + ext);
      try {
        if (process.platform === "win32") {
          // Windows has no executable bit — existence in PATHEXT is enough.
          if (existsSync(candidate)) return candidate;
        } else {
          accessSync(candidate, constants.X_OK);
          return candidate;
        }
      } catch {
        /* not here — try next */
      }
    }
  }
  return null;
}

function getClaudeBinary(): string | null {
  if (claudeBinaryCache !== undefined) return claudeBinaryCache;
  claudeBinaryCache = findBinaryOnPath("claude");
  return claudeBinaryCache;
}

function getCodexBinary(): string | null {
  if (codexBinaryCache !== undefined) return codexBinaryCache;
  codexBinaryCache = findBinaryOnPath("codex");
  return codexBinaryCache;
}

function getOpencodeBinary(): string | null {
  if (opencodeBinaryCache !== undefined) return opencodeBinaryCache;
  opencodeBinaryCache = findBinaryOnPath("opencode");
  return opencodeBinaryCache;
}

function getCopilotBinary(): string | null {
  if (copilotBinaryCache !== undefined) return copilotBinaryCache;
  copilotBinaryCache = findBinaryOnPath("copilot");
  return copilotBinaryCache;
}

function getCursorBinary(): string | null {
  if (cursorBinaryCache !== undefined) return cursorBinaryCache;
  cursorBinaryCache = findBinaryOnPath("cursor-agent");
  return cursorBinaryCache;
}

function hasClaudeBinary(): boolean {
  return getClaudeBinary() !== null;
}
function hasCodexBinary(): boolean {
  return getCodexBinary() !== null;
}
function hasOpencodeBinary(): boolean {
  return getOpencodeBinary() !== null;
}
function hasCopilotBinary(): boolean {
  return getCopilotBinary() !== null;
}
function hasCursorBinary(): boolean {
  return getCursorBinary() !== null;
}

/** Test-only: reset the cached claude-binary resolution. */
export function _resetClaudeBinaryCache(): void {
  claudeBinaryCache = undefined;
}

/** Test-only: reset the cached codex-binary resolution. */
export function _resetCodexBinaryCache(): void {
  codexBinaryCache = undefined;
}

/** Test-only: reset the cached opencode-binary resolution. */
export function _resetOpencodeBinaryCache(): void {
  opencodeBinaryCache = undefined;
}

/** Test-only: reset the cached copilot-binary resolution. */
export function _resetCopilotBinaryCache(): void {
  copilotBinaryCache = undefined;
}

/** Test-only: reset the cached cursor-binary resolution. */
export function _resetCursorBinaryCache(): void {
  cursorBinaryCache = undefined;
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

/**
 * Build the argv for `codex exec …` from inference options. Pure.
 *
 * Recursion + tool-use defense (mirrors claude's `--setting-sources '' --tools ''`):
 *   --ignore-user-config  → no ~/.codex/config.toml → no hooks load in the child
 *   --ignore-rules        → no execpolicy .rules files load
 *   --sandbox read-only   → child cannot execute shell commands even if it tries
 *   --ephemeral           → no session persistence; one-shot only
 *
 * Codex has no --system-prompt equivalent — the full prompt is a single positional
 * argv string. We concatenate system + user + JSON-schema instruction into one
 * prompt. ARG_MAX is ~256KB on macOS; typical PAL prompts are 1-2KB.
 */
export function buildCodexArgs(opts: InferenceOptions): string[] {
  const parts: string[] = [];
  if (opts.system) parts.push(opts.system);
  parts.push(opts.user);
  if (opts.jsonSchema) {
    parts.push(
      `Respond with ONLY a JSON value matching this schema (no prose, no markdown): ${JSON.stringify(opts.jsonSchema)}`
    );
  }
  const prompt = parts.join("\n\n");
  return [
    "exec",
    "--color",
    "never",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "--ephemeral",
    prompt,
  ];
}

/**
 * Build the argv for `opencode run …` from inference options. Pure.
 *
 * Recursion defense:
 *   --pure         → run WITHOUT external plugins → PAL's own opencode plugin
 *                    doesn't load in the spawned child → no hook recursion.
 *   --format json  → emits NDJSON events on stdout; we extract the agent's
 *                    text via extractOpencodeText() rather than wading through
 *                    decoration ("> build · provider/model" banner etc).
 *
 * opencode (like codex) has no --system-prompt equivalent — the full prompt is
 * the positional message argv. System + user + JSON-schema are concatenated.
 * Provider/model is left unset so opencode uses the user's configured default.
 */
export function buildOpencodeArgs(opts: InferenceOptions): string[] {
  const parts: string[] = [];
  if (opts.system) parts.push(opts.system);
  parts.push(opts.user);
  if (opts.jsonSchema) {
    parts.push(
      `Respond with ONLY a JSON value matching this schema (no prose, no markdown): ${JSON.stringify(opts.jsonSchema)}`
    );
  }
  const prompt = parts.join("\n\n");
  return ["run", "--pure", "--format", "json", prompt];
}

/**
 * Build the argv for `cursor-agent -p …` from inference options. Pure.
 *
 * Recursion + tool-use defense:
 *   --mode ask          → read-only Q&A; the agent cannot edit files or run
 *                          shell commands, eliminating any path back into our
 *                          hooks. Cursor's equivalent of claude's `--tools ''`
 *                          and codex's `--sandbox read-only`.
 *   --output-format text → clean stdout (default but explicit)
 *   --trust              → required for headless mode; without it, cursor-agent
 *                          exits 0 with a "trust this directory" hint instead
 *                          of running inference. Safe to pair with --mode ask
 *                          because that mode disallows tool calls anyway.
 *
 * cursor-agent has no --system-prompt flag — system + user + JSON-schema are
 * concatenated into a single positional prompt argument.
 *
 * Auth note: cursor-agent picks up either `cursor-agent login` credentials or
 * `CURSOR_API_KEY` env var. PAL doesn't manage these — that's the user's setup.
 */
export function buildCursorArgs(opts: InferenceOptions): string[] {
  const parts: string[] = [];
  if (opts.system) parts.push(opts.system);
  parts.push(opts.user);
  if (opts.jsonSchema) {
    parts.push(
      `Respond with ONLY a JSON value matching this schema (no prose, no markdown): ${JSON.stringify(opts.jsonSchema)}`
    );
  }
  const prompt = parts.join("\n\n");
  return ["-p", "--mode", "ask", "--output-format", "text", "--trust", prompt];
}

/**
 * Build the argv for `copilot -p …` from inference options. Pure.
 *
 * Recursion defense:
 *   --no-custom-instructions  → don't load PAL's copilot custom instructions
 *                                in the spawned child (equivalent to claude's
 *                                `--setting-sources ''` and opencode's `--pure`)
 *   --disable-builtin-mcps    → no MCP servers in the child (extra safety)
 *   --no-auto-update          → prevent CLI self-update from delaying the spawn
 *   --no-color                → clean stdout for capture
 *   --allow-all-tools         → REQUIRED for non-interactive mode (without it,
 *                                copilot prompts for tool-use confirmation)
 *
 * Copilot has no --system-prompt flag — system + user + JSON-schema are
 * concatenated into a single prompt passed via -p.
 */
export function buildCopilotArgs(opts: InferenceOptions): string[] {
  const parts: string[] = [];
  if (opts.system) parts.push(opts.system);
  parts.push(opts.user);
  if (opts.jsonSchema) {
    parts.push(
      `Respond with ONLY a JSON value matching this schema (no prose, no markdown): ${JSON.stringify(opts.jsonSchema)}`
    );
  }
  const prompt = parts.join("\n\n");
  return [
    "-p",
    prompt,
    "--no-custom-instructions",
    "--disable-builtin-mcps",
    "--no-auto-update",
    "--no-color",
    "--allow-all-tools",
  ];
}

/**
 * Extract the agent's text reply from opencode --format json NDJSON output.
 * Concatenates all `type:"text"` event payloads in order. Returns empty
 * string on parse failure or no text events.
 */
export function extractOpencodeText(rawStdout: string): string {
  const texts: string[] = [];
  for (const line of rawStdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        part?: { type?: string; text?: string };
      };
      if (event.type === "text" && event.part?.type === "text" && event.part.text) {
        texts.push(event.part.text);
      }
    } catch {
      /* not a JSON line — opencode also emits non-JSON lines, skip them */
    }
  }
  return texts.join("").trim();
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

interface RawSpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * One CLI invocation. Returns raw streams + exit info, no parsing.
 * Used by every per-agent dispatcher (claude --print, codex exec, etc).
 */
async function singleCliAttempt(
  binary: string,
  args: string[],
  stdinInput: string,
  env: NodeJS.ProcessEnv,
  timeout: number
): Promise<RawSpawnResult> {
  return new Promise<RawSpawnResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (r: RawSpawnResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([binary, ...args], {
        env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err) {
      void logError("inference:spawn", err);
      finish({ code: null, stdout: "", stderr: "", timedOut: false });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }, timeout);

    const stdinWriter =
      proc.stdin && typeof proc.stdin !== "number"
        ? (proc.stdin as {
            write: (s: string) => void;
            end: () => void;
            close?: () => void;
          })
        : null;
    if (stdinWriter) {
      try {
        if (stdinInput) stdinWriter.write(stdinInput);
        stdinWriter.end();
      } catch (err) {
        void logError("inference:stdin", err);
      }
    }

    void (async () => {
      const stdoutStream =
        proc.stdout && typeof proc.stdout !== "number"
          ? (proc.stdout as ReadableStream<Uint8Array>)
          : null;
      const stderrStream =
        proc.stderr && typeof proc.stderr !== "number"
          ? (proc.stderr as ReadableStream<Uint8Array>)
          : null;
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
      finish({ code: proc.exitCode, stdout, stderr, timedOut });
    })();
  });
}

/**
 * Generic CLI dispatcher: spawn `binary args`, write stdinInput to stdin (may be
 * empty for argv-only CLIs like codex), capture stdout, retry once on empty-abort.
 * Mirrors PAI's universal pattern across all supported subscription CLIs.
 */
async function inferenceViaCliSpawn(
  binary: string,
  args: string[],
  stdinInput: string,
  opts: InferenceOptions,
  extractText?: (rawStdout: string) => string
): Promise<InferenceResult> {
  const timeout = opts.timeout ?? 15000;
  const env = buildSpawnGuardEnv(process.env);
  const started = Date.now();
  const caller = opts.caller ?? "anonymous";
  const session = opts.sessionId ?? "-";
  const tag = `caller=${caller} sessionId=${session}`;
  // Friendly name for logs — strip path + extension so cross-platform diffs
  // (e.g. C:\…\claude.cmd vs /usr/local/bin/claude) read the same in debug.log.
  const binaryName = basename(binary).replace(/\.(cmd|bat|exe|com)$/i, "");

  // Attempt 1
  let attempt = await singleCliAttempt(binary, args, stdinInput, env, timeout);

  // Universal retry on empty-output exit≠0 (correlates strongly with burst-
  // concurrency races — the binary silently aborts without writing to either
  // stream). One retry only, 500-1500ms jitter so the burst settles.
  const isEmptyAbort =
    attempt.code !== 0 &&
    !attempt.timedOut &&
    attempt.stdout.length === 0 &&
    attempt.stderr.length === 0;
  if (isEmptyAbort) {
    const jitterMs = 500 + Math.floor(Math.random() * 1000);
    logDebug(
      "inference:spawn",
      `${tag} retry: empty-abort binary=${binaryName} exit=${attempt.code} after ${Date.now() - started}ms, jitter=${jitterMs}ms`
    );
    await new Promise((r) => setTimeout(r, jitterMs));
    attempt = await singleCliAttempt(binary, args, stdinInput, env, timeout);
  }

  const elapsedMs = Date.now() - started;
  const finish = (result: InferenceResult): InferenceResult => {
    logDebug(
      "inference:spawn",
      `${tag} done binary=${binaryName} success=${result.success} bytes=${result.output?.length ?? 0} elapsedMs=${elapsedMs}`
    );
    return result;
  };

  if (attempt.timedOut) {
    void logError(
      "inference:spawn",
      `${tag} timeout binary=${binaryName} after ${timeout}ms`
    );
    return finish({ success: false });
  }
  if (attempt.code !== 0) {
    void logError(
      "inference:spawn",
      `${tag} exited=${attempt.code} binary=${binaryName} argv=${JSON.stringify(args)} stderr(${attempt.stderr.length})=${attempt.stderr.slice(0, 300)} stdout(${attempt.stdout.length})=${attempt.stdout.slice(0, 300)}`
    );
    return finish({ success: false });
  }
  const rawText = attempt.stdout.trim();
  if (!rawText) return finish({ success: false });
  const text = extractText ? extractText(rawText) : rawText;
  if (!text) {
    // Extraction returned empty — the binary succeeded but our extractor found
    // no usable text. Log the raw stdout so we can see what was actually emitted.
    void logError(
      "inference:spawn",
      `${tag} extract-empty binary=${binaryName} rawStdout(${rawText.length})=${rawText.slice(0, 500)}`
    );
    return finish({ success: false });
  }
  if (opts.jsonSchema) {
    const parsed = parseJsonFromOutput(text);
    if (parsed === null) return finish({ success: false, output: text });
    return finish({ success: true, output: JSON.stringify(parsed) });
  }
  return finish({ success: true, output: text });
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

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI API path — fallback for codex users without a codex binary on PATH.
// Codex users almost always have an OpenAI key already; falling back to
// Anthropic for them would be backwards. Uses chat/completions with the
// structured-output schema for JSON-mode callers.
// ─────────────────────────────────────────────────────────────────────────────

const OPENAI_DEFAULT_MODEL = "gpt-5.4-mini";

async function inferenceViaOpenAiApi(opts: InferenceOptions): Promise<InferenceResult> {
  const apiKey = process.env.PAL_OPENAI_API_KEY;
  if (!apiKey) return { success: false };

  const {
    system,
    user,
    model = OPENAI_DEFAULT_MODEL,
    maxTokens = 500,
    timeout = 15000,
    jsonSchema,
  } = opts;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const messages: Array<{ role: string; content: string }> = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: user });

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages,
    };
    if (jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "structured_response", strict: true, schema: jsonSchema },
      };
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      await logError(
        "inference:openai",
        `HTTP ${response.status}: ${errBody.slice(0, 200)}`
      );
      return { success: false };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const rawUsage = data?.usage as
      | { prompt_tokens?: number; completion_tokens?: number }
      | undefined;
    const usage =
      rawUsage?.prompt_tokens != null && rawUsage?.completion_tokens != null
        ? {
            inputTokens: rawUsage.prompt_tokens,
            outputTokens: rawUsage.completion_tokens,
          }
        : undefined;

    const choices = data?.choices as
      | Array<{ message?: { content?: string } }>
      | undefined;
    const text = choices?.[0]?.message?.content?.trim();
    if (!text) return { success: false, usage };

    return { success: true, output: text, usage };
  } catch (err) {
    await logError("inference:openai", err);
    return { success: false };
  }
}

import { basename } from "node:path";
import { agentFailureText, parseJsonFromOutput } from "./inference-prompt";
import type { InferenceOptions, InferenceResult } from "./inference-types";
import type { InferenceUsage } from "./inference-usage";
import { logDebug, logError } from "./log";
import { withPalEnv } from "./pal-env";
import { buildSpawnGuardEnv } from "./spawn-guard";

function firstLine(text: string): string | undefined {
  return text
    .split("\n")
    .find((line) => line.trim())
    ?.trim();
}

interface RawSpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

async function readPipe(pipe: unknown): Promise<string> {
  if (!pipe || typeof pipe === "number") return "";

  try {
    return await new Response(pipe as ReadableStream<Uint8Array>).text();
  } catch {
    return "";
  }
}

function killQuietly(proc: ReturnType<typeof Bun.spawn>): void {
  try {
    proc.kill();
  } catch {
    /* ignore */
  }
}

function writeStdinAndClose(
  proc: ReturnType<typeof Bun.spawn>,
  stdinInput: string
): void {
  const stdinWriter =
    proc.stdin && typeof proc.stdin !== "number"
      ? (proc.stdin as {
          write: (s: string) => void;
          end: () => void;
          close?: () => void;
        })
      : null;
  if (!stdinWriter) return;

  try {
    if (stdinInput) stdinWriter.write(stdinInput);
    stdinWriter.end();
  } catch (err) {
    logError("inference:stdin", err);
  }
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
  timeout: number,
  cwd?: string
): Promise<RawSpawnResult> {
  return new Promise<RawSpawnResult>((resolve) => {
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
        cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      });
    } catch (err) {
      logError("inference:spawn", err);
      finish({ code: null, stdout: "", stderr: "", timedOut: false });

      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killQuietly(proc);
    }, timeout);

    writeStdinAndClose(proc, stdinInput);

    void (async () => {
      const stdout = await readPipe(proc.stdout);
      const stderr = await readPipe(proc.stderr);
      await proc.exited;
      clearTimeout(timer);
      finish({ code: proc.exitCode, stdout, stderr, timedOut });
    })();
  });
}

/** How to read a CLI's stdout: the reply's text, and what the call cost. */
export interface CliReply {
  text: (rawStdout: string) => string;
  usage: (rawStdout: string) => InferenceUsage | undefined;
}

const PLAIN_REPLY: CliReply = { text: (raw) => raw, usage: () => undefined };

export interface SpawnPlace {
  cwd?: string;
  env?: Record<string, string | undefined>;
  logTag?: string;
  /** Sees the final attempt's stdout whatever the outcome, timeouts included. */
  afterRun?: (rawStdout: string) => void;
}

function retryJitterMs(): number {
  const fixed = process.env.PAL_INFERENCE_RETRY_JITTER_MS;
  if (fixed !== undefined && /^\d+$/.test(fixed)) return Number(fixed);

  return 500 + Math.floor(Math.random() * 1000);
}

/**
 * Generic CLI dispatcher: spawn `binary args`, write stdinInput to stdin (may be
 * empty for argv-only CLIs like codex), capture stdout, retry once on empty-abort.
 * Mirrors PAI's universal pattern across all supported subscription CLIs.
 */
export async function inferenceViaCliSpawn(
  binary: string,
  args: string[],
  stdinInput: string,
  opts: InferenceOptions,
  reply: CliReply = PLAIN_REPLY,
  place: SpawnPlace = {}
): Promise<InferenceResult> {
  const timeout = opts.timeout ?? 15000;
  const env = { ...buildSpawnGuardEnv(withPalEnv(process.env)), ...place.env };
  const started = Date.now();
  const log: SpawnLog = {
    tag: spawnLogTag(opts, place),
    binaryName: friendlyBinaryName(binary),
    timeout,
    args,
  };
  const runOnce = () =>
    singleCliAttempt(binary, args, stdinInput, env, timeout, place.cwd);
  const attempt = await attemptWithEmptyAbortRetry(runOnce, log, started);

  place.afterRun?.(attempt.stdout);
  const elapsedMs = Date.now() - started;
  const usage = reply.usage(attempt.stdout);
  const result = attemptOutcome(attempt, opts, reply, log);
  logDebug(
    "inference:spawn",
    `${log.tag} done binary=${log.binaryName} success=${result.success} bytes=${result.output?.length ?? 0} elapsedMs=${elapsedMs}`
  );

  return { ...result, usage };
}

interface SpawnLog {
  tag: string;
  binaryName: string;
  timeout: number;
  args: string[];
}

function spawnLogTag(opts: InferenceOptions, place: SpawnPlace): string {
  const caller = opts.caller ?? "anonymous";
  const session = opts.sessionId ?? "-";

  return [`caller=${caller}`, `sessionId=${session}`, place.logTag]
    .filter(Boolean)
    .join(" ");
}

// Path and extension are stripped so cross-platform diffs
// (e.g. C:\…\claude.cmd vs /usr/local/bin/claude) read the same in debug.log.
function friendlyBinaryName(binary: string): string {
  return basename(binary).replace(/\.(cmd|bat|exe|com)$/i, "");
}

function isEmptyAbort(attempt: RawSpawnResult): boolean {
  return (
    attempt.code !== 0 &&
    !attempt.timedOut &&
    attempt.stdout.length === 0 &&
    attempt.stderr.length === 0
  );
}

// Under burst concurrency the agent binary can exit non-zero with no output at all;
// one retry after 500-1500 ms of jitter lets the burst settle.
async function attemptWithEmptyAbortRetry(
  runOnce: () => Promise<RawSpawnResult>,
  log: SpawnLog,
  started: number
): Promise<RawSpawnResult> {
  const attempt = await runOnce();
  if (!isEmptyAbort(attempt)) return attempt;

  const jitterMs = retryJitterMs();
  logDebug(
    "inference:spawn",
    `${log.tag} retry: empty-abort binary=${log.binaryName} exit=${attempt.code} after ${Date.now() - started}ms, jitter=${jitterMs}ms`
  );
  await new Promise((r) => setTimeout(r, jitterMs));

  return await runOnce();
}

function attemptOutcome(
  attempt: RawSpawnResult,
  opts: InferenceOptions,
  reply: CliReply,
  log: SpawnLog
): InferenceResult {
  if (attempt.timedOut) {
    logError(
      "inference:spawn",
      `${log.tag} timeout binary=${log.binaryName} after ${log.timeout}ms`
    );

    return { success: false };
  }

  if (attempt.code !== 0) {
    const said = agentFailureText(attempt.stdout);
    logError(
      "inference:spawn",
      `${log.tag} exited=${attempt.code} binary=${log.binaryName} argv=${JSON.stringify(log.args)} stderr(${attempt.stderr.length})=${attempt.stderr.slice(0, 300)} stdout(${attempt.stdout.length})=${said.slice(0, 300)}`
    );

    return { success: false, error: firstLine(attempt.stderr || said) };
  }

  return replyOutcome(attempt.stdout, opts, reply, log);
}

function replyOutcome(
  stdout: string,
  opts: InferenceOptions,
  reply: CliReply,
  log: SpawnLog
): InferenceResult {
  const rawText = stdout.trim();
  if (!rawText) return { success: false };
  const text = reply.text(rawText);
  if (!text) {
    // The binary succeeded but the extractor found no usable text, so the raw
    // stdout is logged to show what was actually emitted.
    logError(
      "inference:spawn",
      `${log.tag} extract-empty binary=${log.binaryName} rawStdout(${rawText.length})=${rawText.slice(0, 500)}`
    );

    return { success: false };
  }

  if (!opts.jsonSchema) return { success: true, output: text };

  const parsed = parseJsonFromOutput(text);
  if (parsed === null) return { success: false, output: text };

  return { success: true, output: JSON.stringify(parsed) };
}

import { totalmem } from "node:os";
import { normalizeToolUse } from "./agent";
import { appendEvent, logQuietly } from "./events";
import { hookSessionId } from "./hook-turn";
import { unappliedVerdictOf } from "./ledger-hook";
import { commandSlurps, diskProbe, type FileProbe, type SlurpHit } from "./slurp-detect";
import { isPalSpawnedInference } from "./spawn-guard";
import { COMMAND_KEYS, resultOf, stringIn } from "./tool-events";

export const NOTEWORTHY_BYTES = 64 * 1024 * 1024;
const OUTPUT_TAIL_CHARS = 4096;

const OOM_SIGNS = [
  /exit code:?\s*(?:137|-9)\b/i,
  /^Killed(?::\s*9)?\s*$/m,
  /\bMemoryError\b/,
  /heap out of memory/i,
  /\bout of memory\b/i,
  /Cannot allocate memory/,
  /std::bad_alloc/,
];

function riskyBytes(totalMemory = totalmem()): number {
  return Math.floor(totalMemory / 8);
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) return "";

  return typeof value === "string" ? value : JSON.stringify(value);
}

function outputTail(payload: Record<string, unknown>): string {
  const text = `${textOf(payload.error)}\n${textOf(resultOf(payload))}`;

  return text.slice(-OUTPUT_TAIL_CHARS);
}

export function showsOutOfMemory(payload: Record<string, unknown>): boolean {
  const tail = outputTail(payload);
  const exit = payload.exit_code ?? payload.exitCode;

  return exit === 137 || exit === -9 || OOM_SIGNS.some((sign) => sign.test(tail));
}

function neverRan(payload: Record<string, unknown>): boolean {
  return unappliedVerdictOf(payload)?.outcome === "denied";
}

export interface SlurpVerdict {
  command: string;
  hits: SlurpHit[];
  predicted: boolean;
  oom: boolean;
  thresholdBytes: number;
}

export function slurpVerdictOf(
  payload: Record<string, unknown>,
  cwd: string,
  probe: FileProbe = diskProbe,
  thresholdBytes = riskyBytes()
): SlurpVerdict | null {
  const call = normalizeToolUse(payload);
  const command = call ? stringIn(call.toolInput, COMMAND_KEYS) : null;
  if (!command || neverRan(payload)) return null;
  const hits = commandSlurps(command, cwd, probe).filter(
    (h) => h.bytes >= NOTEWORTHY_BYTES
  );
  const oom = showsOutOfMemory(payload);
  if (hits.length === 0 && !oom) return null;
  const predicted = hits.some((h) => h.bytes >= thresholdBytes);

  return { command, hits, predicted, oom, thresholdBytes };
}

function workspaceOf(payload: Record<string, unknown>): string {
  return stringIn(payload, ["cwd"]) ?? process.cwd();
}

export function recordSlurpCheck(
  payload: Record<string, unknown> | null,
  cwd = payload ? workspaceOf(payload) : process.cwd()
): void {
  if (!payload || isPalSpawnedInference()) return;
  logQuietly("slurp_check", () => {
    const verdict = slurpVerdictOf(payload, cwd);
    if (!verdict) return;
    appendEvent(
      "slurp_check",
      {
        mode: "shadow",
        predicted: verdict.predicted,
        oom: verdict.oom,
        hitCount: verdict.hits.length,
        maxBytes: Math.max(0, ...verdict.hits.map((h) => h.bytes)),
        thresholdBytes: verdict.thresholdBytes,
        idioms: [...new Set(verdict.hits.map((h) => h.idiom))],
      },
      {
        session: hookSessionId(payload) ?? null,
        content: { command: verdict.command, hits: verdict.hits },
      }
    );
  });
}

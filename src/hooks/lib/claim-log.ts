/**
 * The claim check at stop: every reply that makes a result or status claim is logged to
 * memory/signals/claim-checks/ with its verdict. The claiming sentence is kept
 * only when no command backed it, so the log can be audited. Sending the reply
 * back is opt-in (dynamicContext.claimCheckBlocks).
 */

import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentAttribution } from "./actor";
import {
  type ClaimCheck,
  type ClaimVerdict,
  checkClaims,
  commandsThisTurn,
  isVersionControlClaim,
} from "./claim-check";
import { hookFinalReply, hookSessionId } from "./hook-turn";
import { ensureDir, paths } from "./paths";
import { isEnabled, isOptedIn } from "./settings";
import type { StopTurnPayload } from "./stop";

const CLAIM_MAX = 200;

export interface ClaimRecord {
  ts: string;
  session: string;
  runtime?: string;
  verdict: ClaimVerdict;
  commands: number | null;
  claims?: string[];
  blocked?: true;
}

function claimsDir(): string {
  return ensureDir(resolve(paths.signals(), "claim-checks"));
}

function monthFile(date: Date): string {
  return resolve(claimsDir(), `${date.toISOString().slice(0, 7)}.jsonl`);
}

function transcriptLines(payload: StopTurnPayload): string[] {
  const path = payload.transcript_path ?? payload.transcriptPath;
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf-8").split("\n").filter(Boolean);
}

function needsAudit(verdict: ClaimVerdict): boolean {
  return verdict === "unbacked" || verdict === "unknown";
}

interface Watched {
  check: ClaimCheck;
  commands: number | null;
  session: string;
  blocked: boolean;
}

function record({ check, commands, session, blocked }: Watched, now: Date) {
  const line: ClaimRecord = {
    ts: now.toISOString(),
    session,
    runtime: currentAttribution().runtime,
    verdict: check.verdict,
    commands,
    ...(needsAudit(check.verdict) && {
      claims: check.claims.map((c) => c.slice(0, CLAIM_MAX)),
    }),
    ...(blocked && { blocked }),
  };
  appendFileSync(monthFile(now), `${JSON.stringify(line)}\n`);
}

export function alreadySentBack(payload: StopTurnPayload): boolean {
  return payload.stop_hook_active === true || (payload.loop_count ?? 0) > 0;
}

function sendsBack(payload: StopTurnPayload, check: ClaimCheck): boolean {
  return (
    check.verdict === "unbacked" &&
    isOptedIn("claimCheckBlocks") &&
    !alreadySentBack(payload)
  );
}

function sendBackReason(claims: string[]): string {
  const quoted = claims.map((c) => `"${c.slice(0, CLAIM_MAX)}"`).join(", ");
  const ask = claims.some(isVersionControlClaim)
    ? "Read what is committed, pushed, merged or released with git or gh and show it"
    : "Run the check and show its output";
  return `Your reply claims what no command in this turn showed: ${quoted}. ${ask}, or say it is unverified.`;
}

/**
 * Checks the final reply against the turn's commands and logs any claim.
 * Returns the reason to send the reply back with, when that is opted in.
 */
export function watchClaims(
  payload: StopTurnPayload | null,
  now: Date = new Date()
): string | null {
  if (!payload || !isEnabled("claimCheck")) return null;
  const reply = hookFinalReply(payload);
  if (!reply) return null;
  const commands = commandsThisTurn(transcriptLines(payload));
  const check = checkClaims(reply, commands);
  if (check.verdict === "none") return null;
  const blocked = sendsBack(payload, check);
  const session = hookSessionId(payload) ?? "unknown";
  record({ check, commands: commands?.length ?? null, session, blocked }, now);
  return blocked ? sendBackReason(check.claims) : null;
}

function readRecords(file: string): ClaimRecord[] {
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ClaimRecord];
      } catch {
        return [];
      }
    });
}

export function claimChecksSince(since: Date): ClaimRecord[] {
  const fromMonth = since.toISOString().slice(0, 7);
  const sinceTs = since.toISOString();
  return readdirSync(claimsDir())
    .filter((f) => f.endsWith(".jsonl") && f.slice(0, 7) >= fromMonth)
    .sort()
    .flatMap((f) => readRecords(resolve(claimsDir(), f)))
    .filter((r) => r.ts >= sinceTs);
}

/**
 * Watch mode for the claim check: every reply that makes a result claim is
 * logged to memory/signals/claim-checks/ with its verdict. The claiming
 * sentence is kept only when no command backed it, so the log can be audited.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentAttribution } from "./actor";
import {
  type ClaimCheck,
  type ClaimVerdict,
  checkClaims,
  commandsThisTurn,
} from "./claim-check";
import { hookFinalReply, hookSessionId } from "./hook-turn";
import { ensureDir, paths } from "./paths";
import { isEnabled } from "./settings";
import type { StopTurnPayload } from "./stop";

const CLAIM_MAX = 200;

export interface ClaimRecord {
  ts: string;
  session: string;
  runtime?: string;
  verdict: ClaimVerdict;
  commands: number | null;
  claims?: string[];
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

function record(check: ClaimCheck, commands: number | null, session: string, now: Date) {
  const line: ClaimRecord = {
    ts: now.toISOString(),
    session,
    runtime: currentAttribution().runtime,
    verdict: check.verdict,
    commands,
    ...(needsAudit(check.verdict) && {
      claims: check.claims.map((c) => c.slice(0, CLAIM_MAX)),
    }),
  };
  appendFileSync(monthFile(now), `${JSON.stringify(line)}\n`);
}

/** Checks the final reply against the turn's commands and logs any result claim. */
export function watchClaims(
  payload: StopTurnPayload | null,
  now: Date = new Date()
): ClaimCheck | null {
  if (!payload || !isEnabled("claimCheck")) return null;
  const reply = hookFinalReply(payload);
  if (!reply) return null;
  const commands = commandsThisTurn(transcriptLines(payload));
  const check = checkClaims(reply, commands);
  if (check.verdict !== "none")
    record(check, commands, hookSessionId(payload) ?? "unknown", now);
  return check;
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

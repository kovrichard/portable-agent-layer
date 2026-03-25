/**
 * CLI tool: print a brief session summary after Claude Code exits.
 * Designed to be called from the `pal` wrapper script.
 *
 * Usage: bun run tools/session-summary.ts --session <sessionId>
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { MODEL_PRICING } from "../hooks/lib/models";

// ── Types ──

interface Usage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  cost: number;
  calls: number;
  models: Set<string>;
  durationMs: number;
}

// ── Core Functions ──

export function findSessionFile(
  sessionId: string,
  claudeDir: string
): { filepath: string; project: string } | null {
  if (!existsSync(claudeDir)) return null;

  const projectDirs = readdirSync(claudeDir, { withFileTypes: true }).filter((d) =>
    d.isDirectory()
  );

  for (const dir of projectDirs) {
    const projPath = resolve(claudeDir, dir.name);
    const projName = dir.name.split("-").pop() ?? dir.name;

    const directFile = resolve(projPath, `${sessionId}.jsonl`);
    if (existsSync(directFile)) {
      return { filepath: directFile, project: projName };
    }
  }

  // Fallback: scan most recently modified files
  let latest: { filepath: string; project: string; mtime: number } | null = null;

  for (const dir of readdirSync(claudeDir, { withFileTypes: true }).filter((d) =>
    d.isDirectory()
  )) {
    const projPath = resolve(claudeDir, dir.name);
    const projName = dir.name.split("-").pop() ?? dir.name;

    let files: string[];
    try {
      files = readdirSync(projPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      const filepath = resolve(projPath, file);
      try {
        const mtime = Bun.file(filepath).lastModified;
        if (!latest || mtime > latest.mtime) {
          latest = { filepath, project: projName, mtime };
        }
      } catch {
        /* skip */
      }
    }
  }

  return latest;
}

export function parseSession(filepath: string, sessionId: string): Usage {
  const usage: Usage = {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    cost: 0,
    calls: 0,
    models: new Set(),
    durationMs: 0,
  };

  const content = readFileSync(filepath, "utf-8");
  let firstTs = "";
  let lastTs = "";

  for (const line of content.split("\n")) {
    if (!line) continue;

    try {
      const d = JSON.parse(line) as {
        type?: string;
        timestamp?: string;
        sessionId?: string;
        message?: {
          model?: string;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
          };
        };
      };

      if (d.sessionId !== sessionId) continue;

      if (d.timestamp) {
        if (!firstTs) firstTs = d.timestamp;
        lastTs = d.timestamp;
      }

      if (d.type !== "assistant") continue;
      const u = d.message?.usage;
      const model = d.message?.model;
      if (!u || !model) continue;

      const input = u.input_tokens ?? 0;
      const output = u.output_tokens ?? 0;
      const cw = u.cache_creation_input_tokens ?? 0;
      const cr = u.cache_read_input_tokens ?? 0;

      const p = MODEL_PRICING[model];
      if (p) {
        usage.cost +=
          (input * p.input + output * p.output + cw * p.cacheWrite + cr * p.cacheRead) /
          1_000_000;
      }

      usage.input += input;
      usage.output += output;
      usage.cacheWrite += cw;
      usage.cacheRead += cr;
      usage.calls++;
      usage.models.add(model);
    } catch {
      /* skip */
    }
  }

  if (firstTs && lastTs) {
    usage.durationMs = new Date(lastTs).getTime() - new Date(firstTs).getTime();
  }

  return usage;
}

// ── Format helpers ──

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

// ── CLI ──

function run() {
  const { values: args } = parseArgs({
    options: { session: { type: "string" } },
    strict: false,
  });

  const sessionId = typeof args.session === "string" ? args.session : "";
  if (!sessionId) process.exit(0);

  const claudeDir = resolve(homedir(), ".claude", "projects");
  const file = findSessionFile(sessionId, claudeDir);
  if (!file) process.exit(0);

  const usage = parseSession(file.filepath, sessionId);
  if (usage.calls === 0) process.exit(0);

  const totalTokens = usage.input + usage.output + usage.cacheWrite + usage.cacheRead;
  const model = [...usage.models].map((m) => m.replace("claude-", "")).join(", ");

  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const cyan = "\x1b[36m";

  console.log(
    `\n${dim}Session: ${file.project} · ${model} · ${fmtDuration(usage.durationMs)} · ${fmtTokens(totalTokens)} tokens · ${usage.calls} calls · ${cyan}${fmtCost(usage.cost)}${reset}`
  );
}

if (import.meta.main) run();

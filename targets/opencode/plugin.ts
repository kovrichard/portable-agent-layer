/**
 * PAI plugin for opencode
 *
 * Mirrors the Claude Code hooks as opencode plugin hooks:
 * - TELOS context injection via system prompt transform
 * - First-run setup wizard (resumable across sessions)
 * - Rating capture from user messages (explicit + implicit sentiment)
 * - Security validation on tool execution
 * - Learning/work capture on session events
 * - Desktop notifications
 */

import type { Plugin } from "@opencode-ai/plugin";
import { readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { resolve, join } from "path";

// --- Resolve PAI_DIR ---
const PAI_DIR = process.env.PAI_DIR || resolve(import.meta.dir, "../..");

// --- Helpers ---
function ensureDir(path: string): string {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
  return path;
}

function now(): string {
  return new Date().toISOString();
}

function monthPath(): string {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fileTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").replace(/\.\d+Z/, "");
}

function signalsDir(): string {
  return ensureDir(join(PAI_DIR, "memory", "signals"));
}

function learningDir(): string {
  return ensureDir(join(PAI_DIR, "memory", "learning"));
}

function stateDir(): string {
  return ensureDir(join(PAI_DIR, "memory", "state"));
}

function timeAgo(isoDate: string): string {
  try {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "unknown";
  }
}

// ============================================================
// Setup state (mirrors hooks/lib/setup.ts)
// ============================================================

interface SetupStep {
  done: boolean;
  file: string;
  question: string;
  hint: string;
}

interface SetupState {
  version: number;
  completed: boolean;
  steps: Record<string, SetupStep>;
}

const SETUP_STEP_DEFS: Record<string, Omit<SetupStep, "done">> = {
  mission: { file: "telos/MISSION.md", question: "What's your name and what do you do?", hint: "Write their name, role, and core purpose to telos/MISSION.md" },
  goals: { file: "telos/GOALS.md", question: "What are your current goals? (short-term, medium-term, long-term)", hint: "Write goals organized by timeframe to telos/GOALS.md" },
  projects: { file: "telos/PROJECTS.md", question: "What projects are you currently working on?", hint: "Write to telos/PROJECTS.md using table format: | Project | Status | Priority | Notes |" },
  beliefs: { file: "telos/BELIEFS.md", question: "What principles or values guide your work?", hint: "Write their values and principles to telos/BELIEFS.md" },
  challenges: { file: "telos/CHALLENGES.md", question: "What are your biggest current challenges?", hint: "Write their challenges and obstacles to telos/CHALLENGES.md" },
};

const STEP_ORDER = Object.keys(SETUP_STEP_DEFS);

function readSetupState(): SetupState | null {
  const p = join(stateDir(), "setup.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}

function buildSetupPrompt(state: SetupState): string | null {
  if (state.completed) return null;
  const remaining = STEP_ORDER.filter((k) => !state.steps[k]?.done);
  if (remaining.length === 0) return null;

  const done = STEP_ORDER.filter((k) => state.steps[k]?.done).length;
  const total = STEP_ORDER.length;

  const lines: string[] = ["## PAI First-Run Setup", ""];
  lines.push(done > 0
    ? `Setup in progress — ${done}/${total} steps complete. Continue from where we left off.`
    : "This is a fresh PAI installation. Guide the user through setup by asking these questions one at a time."
  );
  lines.push("", "### Remaining steps:", "");

  for (const key of remaining) {
    const step = state.steps[key];
    lines.push(`- **${key}** — Ask: "${step.question}" → ${step.hint}`);
  }

  lines.push(
    "", "### After each step:",
    "Read `memory/state/setup.json`, set `steps.<key>.done = true` for the completed step, and write it back.",
    "", "When all steps are done (or the user wants to skip remaining ones), set `completed: true` in setup.json.",
    "", "Keep questions conversational. If the user wants to skip a step, mark it done and move on.",
  );

  return lines.join("\n");
}

// ============================================================
// TELOS + work state loading
// ============================================================

function loadTelos(): string {
  const telosDir = join(PAI_DIR, "telos");
  if (!existsSync(telosDir)) return "";

  const files = readdirSync(telosDir).filter((f) => f.endsWith(".md")).sort();
  const sections: string[] = [];

  for (const file of files) {
    const content = readFileSync(join(telosDir, file), "utf-8").trim();
    const realLines = content
      .split("\n")
      .filter((l) => !l.startsWith("#") && !l.startsWith("<!--") && !l.startsWith("-->") && l.trim());
    if (realLines.length === 0) continue;
    sections.push(content);
  }

  return sections.join("\n\n---\n\n");
}

function countSignals(filename: string): number {
  const filepath = join(signalsDir(), filename);
  if (!existsSync(filepath)) return 0;
  try {
    const content = readFileSync(filepath, "utf-8").trim();
    return content ? content.split("\n").length : 0;
  } catch {
    return 0;
  }
}

function loadActiveWork(): { text: string; summary: string | null } | null {
  const workFile = join(stateDir(), "current-work.json");
  if (!existsSync(workFile)) return null;
  try {
    const data = JSON.parse(readFileSync(workFile, "utf-8"));
    const text = [
      "## Previous Session Context",
      `**Last active:** ${data.ts}`,
      `**Working directory:** ${data.cwd}`,
      `**Last request:** ${data.last_user}`,
    ].join("\n");
    const lastUser = data.last_user?.slice(0, 60) || null;
    return { text, summary: lastUser ? `"${lastUser}"` : null };
  } catch {
    return null;
  }
}

function buildStatusLine(): string {
  const setupState = readSetupState();
  const signalCount = countSignals("ratings.jsonl") + countSignals("learnings.jsonl");
  const work = loadActiveWork();

  const parts: string[] = [];

  if (setupState && !setupState.completed) {
    const done = STEP_ORDER.filter((k) => setupState.steps[k]?.done).length;
    parts.push(`🔧 PAI setup ${done}/${STEP_ORDER.length} | ${signalCount} signals`);
  } else {
    const telosCount = setupState
      ? STEP_ORDER.filter((k) => setupState.steps[k]?.done).length
      : 0;
    parts.push(`✅ PAI ready | ${telosCount} TELOS files | ${signalCount} signals`);
  }

  if (work?.summary) {
    parts.push(`📋 Previous: ${work.summary}`);
  }
  return parts.join("\n");
}

// ============================================================
// Rating detection + handling
// ============================================================

function detectRating(message: string): number | null {
  const match = message.match(/(?:^|rating:?\s*|score:?\s*)(\d|10)(?:\s*(?:\/10|[-.])|$|\s)/i);
  if (!match) return null;
  const rating = parseInt(match[1], 10);
  return rating >= 1 && rating <= 10 ? rating : null;
}

function handleRating(rating: number, context: string, source: string): void {
  const line = JSON.stringify({ ts: now(), type: "rating", rating, context, source });
  appendFileSync(join(signalsDir(), "ratings.jsonl"), line + "\n");

  if (rating < 6) {
    const dir = ensureDir(join(learningDir(), "low-ratings", monthPath()));
    writeFileSync(
      join(dir, `${fileTimestamp()}.md`),
      `# Low Rating: ${rating}/10\n**Source:** ${source}\n**User said:** ${context}\n\n## What went wrong?\n\n## What should be done differently?\n`
    );
  }
}

// --- Implicit sentiment ---
const PRAISE_PATTERNS = /^(great\s*job|nice|perfect|awesome|excellent|thanks|thank\s*you|well\s*done|good\s*job|love\s*it|amazing|brilliant|fantastic|wonderful|superb|nailed\s*it)[.!]?$/i;

async function handleImplicitSentiment(message: string): Promise<void> {
  const trimmed = message.trim();

  if (PRAISE_PATTERNS.test(trimmed)) {
    handleRating(8, trimmed, "implicit");
    return;
  }

  if (trimmed.length < 5 || trimmed.length > 500) return;
  if (/^[\/\$`{]/.test(trimmed) || trimmed.includes("\n\n")) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        messages: [{
          role: "user",
          content: `Rate the sentiment of this user message toward an AI assistant on a 1-10 scale (1=very negative, 5=neutral, 10=very positive). If the message has no clear sentiment toward the assistant, respond with just "neutral". Otherwise respond with just a JSON object: {"rating": N, "sentiment": "one-word"}

Message: "${trimmed.slice(0, 300)}"`,
        }],
      }),
    });

    if (!response.ok) return;

    const data = await response.json() as any;
    const text = data?.content?.[0]?.text?.trim();
    if (!text || text === "neutral") return;

    try {
      const parsed = JSON.parse(text);
      const rating = parsed.rating;
      if (typeof rating === "number" && rating >= 1 && rating <= 10 && rating !== 5) {
        handleRating(rating, `${parsed.sentiment || "inferred"}: ${trimmed.slice(0, 150)}`, "implicit");
      }
    } catch {}
  } catch {}
}

// ============================================================
// Security
// ============================================================

const BLOCKED_COMMANDS: [RegExp, string][] = [
  [/rm\s+-rf\s+[\/~]/, "Recursive delete of root or home"],
  [/mkfs\./, "Filesystem format"],
  [/dd\s+if=.*of=\/dev\//, "Raw disk write"],
  [/>\s*\/dev\/sd/, "Direct device write"],
  [/chmod\s+-R\s+777\s+\//, "Recursive world-writable root"],
  [/:\(\)\{\s*:\|:&\s*\};:/, "Fork bomb"],
  [/curl.*\|\s*(?:ba)?sh/, "Pipe to shell"],
  [/wget.*\|\s*(?:ba)?sh/, "Pipe to shell"],
];

const PROTECTED_PATHS: RegExp[] = [
  /^\/etc\//,
  /^\/boot\//,
  /^\/System\//,
  /\.ssh\/(?!config)/,
  /\.gnupg\//,
];

function desktopNotify(title: string, message: string): void {
  try {
    if (process.platform === "darwin") {
      Bun.spawnSync(["osascript", "-e", `display notification "${message}" with title "${title}"`]);
    } else {
      Bun.spawnSync(["notify-send", title, message]);
    }
  } catch {}
}

// ============================================================
// Plugin export
// ============================================================
const PAIPlugin: Plugin = async ({ project, directory }) => {
  return {
    // --- Inject TELOS context + setup instructions into system prompt ---
    "experimental.chat.system.transform": async (_input, output) => {
      const telos = loadTelos();
      const work = loadActiveWork();
      const setupState = readSetupState();
      const setupPrompt = setupState ? buildSetupPrompt(setupState) : null;

      const ctxParts = ["# Personal Context (TELOS)"];
      if (setupPrompt) ctxParts.push(setupPrompt);
      if (telos) ctxParts.push(telos);
      if (work) ctxParts.push("", work.text);

      output.system.push(ctxParts.join("\n"));

      // Prepend status summary
      output.system.unshift(buildStatusLine());
    },

    // --- Capture ratings from user messages (explicit + implicit) ---
    "chat.message": async (_input, output) => {
      const text = output.parts
        ?.filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join(" ") ?? "";

      const rating = detectRating(text);
      if (rating !== null) {
        handleRating(rating, text.slice(0, 200), "explicit");
        return;
      }

      if (process.env.PAI_IMPLICIT_SENTIMENT === "1") {
        await handleImplicitSentiment(text);
      }
    },

    // --- Security: block dangerous tool executions ---
    "tool.execute.before": async (input, output) => {
      const toolName = input.tool;

      if (toolName === "shell" || toolName === "bash") {
        const cmd = typeof output.args === "string" ? output.args : output.args?.command ?? "";
        for (const [pattern, reason] of BLOCKED_COMMANDS) {
          if (pattern.test(cmd)) {
            throw new Error(`PAI Security: Blocked — ${reason}`);
          }
        }
      }

      if (toolName === "write" || toolName === "edit" || toolName === "patch") {
        const filePath = output.args?.file_path ?? output.args?.filePath ?? output.args?.path ?? "";
        for (const pattern of PROTECTED_PATHS) {
          if (pattern.test(filePath)) {
            throw new Error(`PAI Security: Protected path — ${filePath}`);
          }
        }
      }
    },

    // --- Capture work state after tool use ---
    "tool.execute.after": async (input, _output) => {
      try {
        writeFileSync(
          join(stateDir(), "current-work.json"),
          JSON.stringify({ ts: now(), tool: input.tool, cwd: directory }, null, 2)
        );
      } catch {}
    },

    // --- Inject PAI_DIR into shell environment ---
    "shell.env": async (_input, output) => {
      output.env.PAI_DIR = PAI_DIR;
    },
  };
};

export default PAIPlugin;

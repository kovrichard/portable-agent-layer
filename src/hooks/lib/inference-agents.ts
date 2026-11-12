import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractAntigravityText,
  INFERENCE_AGENT,
  removeSpawnedConversation,
  streamJsonPrompt,
  writeInferenceAgent,
} from "./antigravity-inference";
import { buildCliPrompt, injectJsonSchemaInstruction } from "./inference-prompt";
import { type CliReply, inferenceViaCliSpawn, type SpawnPlace } from "./inference-spawn";
import { type InferenceOptions, type InferenceResult, modelFor } from "./inference-types";
import {
  antigravitySpawnUsage,
  claudeResult,
  claudeSpawnUsage,
  codexSpawnUsage,
  copilotSessionId,
  copilotShutdownUsage,
  copilotSpawnUsage,
  type InferenceUsage,
  jsonLines,
  opencodeSpawnUsage,
} from "./inference-usage";
import { inferenceEffort } from "./models";
import { opencodeTierModel, writeInstructionFreeConfig } from "./opencode-config";
import { withPalEnv } from "./pal-env";
import { platform } from "./paths";

/**
 * Build the argv for `claude --print …`. Pure.
 *
 * `--system-prompt` is deliberately absent: PAL's system prompts run to several
 * paragraphs, and an argv element cannot carry a newline on Windows once
 * Bun.spawn resolves claude to its .cmd shim and cmd.exe re-parses the command
 * line. System, user and any JSON-schema instruction all travel together on
 * stdin instead, the same way every other agent receives them.
 */
const CLAUDE_WEB_TOOLS = "WebSearch,WebFetch";

/** --tools alone makes the web tools visible; --allowed-tools spares them the prompt. */
function claudeTools(opts: InferenceOptions): string[] {
  return opts.web
    ? ["--tools", CLAUDE_WEB_TOOLS, "--allowed-tools", CLAUDE_WEB_TOOLS]
    : ["--tools", ""];
}

export function buildClaudeArgs(
  opts: InferenceOptions,
  systemPromptFile?: string
): string[] {
  const args = [
    "--print",
    "--model",
    modelFor("claude-spawn", opts),
    ...claudeTools(opts),
    "--output-format",
    "json",
    "--setting-sources",
    "",
  ];

  if (systemPromptFile) args.push("--system-prompt-file", systemPromptFile);

  return args;
}

const CLAUDE_REPLY: CliReply = {
  text: (raw) => {
    const result = claudeResult(raw);

    return result?.is_error ? "" : String(result?.result ?? "").trim();
  },
  usage: claudeSpawnUsage,
};

type ClaudeAuthMode = "token" | "native";

function claudeAuthMode(): ClaudeAuthMode {
  return withPalEnv().CLAUDE_CODE_OAUTH_TOKEN ? "token" : "native";
}

/** Lines logged before spawns were tagged came from the native login. */
export function loggedClaudeAuthMode(message: string): ClaudeAuthMode {
  return /\bauth=token\b/.test(message) ? "token" : "native";
}

/** https://code.claude.com/docs/en/authentication#authentication-precedence */
const WITHOUT_KEYS_OUTRANKING_TOKEN = {
  ANTHROPIC_API_KEY: undefined,
  ANTHROPIC_AUTH_TOKEN: undefined,
};

function credentialOverridesFor(mode: ClaudeAuthMode) {
  return mode === "token" ? WITHOUT_KEYS_OUTRANKING_TOKEN : {};
}

/**
 * Claude keeps a real system prompt, unlike the other agents, so the system text
 * reaches it through --system-prompt-file rather than --system-prompt. Only the
 * path travels in argv, which is what makes this work on Windows: an argv
 * element cannot carry a newline once Bun.spawn resolves claude to its .cmd
 * shim, and PAL's system prompts run to several paragraphs. Folding the system
 * text into the user message instead is not an option — Claude treats
 * instructions embedded in message content as an injection attempt and refuses.
 */
export async function inferenceViaClaudeSpawn(
  bin: string,
  opts: InferenceOptions
): Promise<InferenceResult> {
  const mode = claudeAuthMode();
  const spawnClaude = (args: string[]) =>
    inferenceViaCliSpawn(bin, args, opts.user, opts, CLAUDE_REPLY, {
      env: credentialOverridesFor(mode),
      logTag: `auth=${mode}`,
    });
  const system = opts.jsonSchema
    ? injectJsonSchemaInstruction(opts.system ?? "", opts.jsonSchema)
    : opts.system;
  if (!system) return spawnClaude(buildClaudeArgs(opts));

  const dir = await mkdtemp(join(tmpdir(), "pal-system-"));

  try {
    const file = join(dir, "system-prompt.md");
    await writeFile(file, system, "utf-8");

    return await spawnClaude(buildClaudeArgs(opts, file));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Build the argv for `codex exec …` from inference options. Pure.
 *
 * Recursion + tool-use defense (mirrors claude's `--setting-sources '' --tools ''`):
 *   --ignore-user-config  → no ~/.codex/config.toml → no hooks load in the child
 *   --ignore-rules        → no execpolicy .rules files load
 *   --sandbox read-only   → child cannot execute shell commands even if it tries
 *   --ephemeral           → no session persistence; one-shot only
 *   --json                → NDJSON events: the reply and the turn's token usage
 *
 * Codex has no --system-prompt equivalent, so system + user + JSON-schema become
 * one prompt. That prompt goes in on stdin, not as a positional argument, because
 * a PAL prompt spans several paragraphs and an argv element cannot carry a
 * newline on Windows: Bun.spawn resolves the CLI to its .cmd shim, cmd.exe
 * re-parses the command line, and the child exits non-zero having written
 * nothing. Codex reads its instructions from stdin when no positional prompt is
 * given, so this costs nothing on POSIX and is the only thing that works on
 * Windows. Do not move the prompt back into argv.
 */
export function buildCodexArgs(opts: InferenceOptions): string[] {
  return [
    "exec",
    "-m",
    modelFor("codex-spawn", opts),
    "--color",
    "never",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--json",
    ...(opts.web ? ["-c", "web_search=live"] : []),
    ...codexEffortArgs(opts),
  ];
}

function codexEffortArgs(opts: InferenceOptions): string[] {
  const effort = inferenceEffort("codex-spawn", opts.tier);

  return effort ? ["-c", `model_reasoning_effort="${effort}"`] : [];
}

interface CodexItem {
  type?: string;
  text?: string;
}

export const CODEX_REPLY: CliReply = {
  text: (raw) =>
    jsonLines(raw)
      .filter((event) => event.type === "item.completed")
      .map((event) => event.item as CodexItem)
      .findLast((item) => item?.type === "agent_message")
      ?.text?.trim() ?? "",
  usage: codexSpawnUsage,
};

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
 * opencode (like codex) has no --system-prompt equivalent, so system + user +
 * JSON-schema are concatenated and delivered on stdin rather than as the
 * positional message, for the same reason as codex: a multi-paragraph argv
 * element does not survive cmd.exe on Windows. Provider/model is left unset so
 * opencode uses the user's configured default.
 */
export function buildOpencodeArgs(opts: InferenceOptions): string[] {
  const model = opencodeTierModel(opts.tier ?? "small");

  return ["run", "--pure", "--format", "json", ...(model ? ["-m", model] : [])];
}

// Without its own AGENTS.md, opencode falls back to ~/.claude/CLAUDE.md, and it
// lists every Claude and external skill in its tool description.
const OPENCODE_WITHOUT_EXTERNAL_CONTEXT = {
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
};

/** Runs from an empty directory so no project AGENTS.md is in reach either. */
export async function inferenceViaOpencodeSpawn(
  bin: string,
  opts: InferenceOptions
): Promise<InferenceResult> {
  const dir = await mkdtemp(join(tmpdir(), "pal-opencode-"));

  try {
    writeInstructionFreeConfig(dir);

    return await inferenceViaCliSpawn(
      bin,
      buildOpencodeArgs(opts),
      buildCliPrompt(opts),
      opts,
      { text: extractOpencodeText, usage: opencodeSpawnUsage },
      { cwd: dir, env: { XDG_CONFIG_HOME: dir, ...OPENCODE_WITHOUT_EXTERNAL_CONTEXT } }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
 * cursor-agent has no --system-prompt flag, so system + user + JSON-schema are
 * concatenated into one prompt delivered on stdin rather than as the trailing
 * positional argument: a multi-paragraph argv element cannot survive cmd.exe on
 * Windows. `-p` stays because for cursor-agent it means --print, not --prompt.
 *
 * Auth note: cursor-agent picks up either `cursor-agent login` credentials or
 * `CURSOR_API_KEY` env var. PAL doesn't manage these — that's the user's setup.
 */
export function buildCursorArgs(_opts: InferenceOptions): string[] {
  return ["-p", "--mode", "ask", "--output-format", "text", "--trust"];
}

/**
 * Build the argv for a one-turn `agy` stream-json session. Pure.
 *
 * The prompt goes in as one NDJSON `user` event on stdin (streamJsonPrompt), not
 * through `-p`: a multi-paragraph argv element cannot survive cmd.exe on Windows,
 * and stream-json input drops a `-p` prompt anyway. Closing stdin ends the
 * session once the turn's `result` event is out.
 *
 * `--json-schema` is deliberately absent: under the tool-less agent it looped
 * through several turns, so the schema rides in the prompt as for every other CLI.
 */
export function buildAntigravityArgs(opts: InferenceOptions): string[] {
  return [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--model",
    modelFor("antigravity-spawn", opts),
    "--agent",
    INFERENCE_AGENT,
  ];
}

/** Runs from an empty workspace that holds only the tool-less inference agent. */
export async function inferenceViaAntigravitySpawn(
  bin: string,
  opts: InferenceOptions
): Promise<InferenceResult> {
  const dir = await mkdtemp(join(tmpdir(), "pal-antigravity-"));

  try {
    writeInferenceAgent(dir);

    return await inferenceViaCliSpawn(
      bin,
      buildAntigravityArgs(opts),
      streamJsonPrompt(buildCliPrompt(opts)),
      opts,
      { text: extractAntigravityText, usage: antigravitySpawnUsage },
      { cwd: dir, afterRun: removeSpawnedConversation }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
 *   --available-tools=none    → Copilot has no "no tools" flag; an allowlist
 *                                naming an unknown tool hides every tool
 *   --deny-tool=…             → backstop: deny rules win over any allow rule
 *   --silent                  → keeps the tool-filter notices out of stdout
 *   --output-format json      → JSONL events: the reply and the prompt's token usage
 *   web: only web_fetch, pre-approved for every URL; Copilot has no search tool,
 *        so it fetches search pages itself
 *
 * Copilot has no --system-prompt flag, so system + user + JSON-schema are
 * concatenated into one prompt delivered on stdin. `-p/--prompt` is deliberately
 * absent: it takes the prompt inline, and a multi-paragraph argv element cannot
 * survive cmd.exe when Bun.spawn resolves copilot to its Windows .cmd shim.
 * Piping stdin keeps copilot non-interactive, so dropping -p costs nothing.
 */
export function buildCopilotArgs(opts: InferenceOptions): string[] {
  return [
    "--no-custom-instructions",
    "--disable-builtin-mcps",
    "--no-auto-update",
    "--no-color",
    "--silent",
    "--output-format",
    "json",
    ...copilotTools(opts),
    "--deny-tool=shell",
    "--deny-tool=write",
  ];
}

interface CopilotMessage {
  content?: string;
}

const COPILOT_REPLY: CliReply = {
  text: (raw) =>
    jsonLines(raw)
      .filter((event) => event.type === "assistant.message")
      .map((event) => (event.data as CopilotMessage | undefined)?.content?.trim())
      .findLast(Boolean) ?? "",
  usage: copilotSpawnUsage,
};

function copilotSessionUsage(home: string, raw: string): InferenceUsage | undefined {
  const id = copilotSessionId(raw);
  if (!id) return undefined;

  try {
    return copilotShutdownUsage(
      readFileSync(join(home, "session-state", id, "events.jsonl"), "utf-8")
    );
  } catch {
    return undefined;
  }
}

/** stdout reports only the prompt side; the run's own session file in its home has the rest. */
function copilotReply(home: string): CliReply {
  return {
    ...COPILOT_REPLY,
    usage: (raw) => copilotSessionUsage(home, raw) ?? copilotSpawnUsage(raw),
  };
}

const COPILOT_TOKEN_ENV = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];

/** A /login account lives in COPILOT_HOME's config.json; only a token variable logs in without it. */
function copilotLogsInWithoutHome(env: NodeJS.ProcessEnv): boolean {
  return COPILOT_TOKEN_ENV.some((name) => Boolean(env[name]));
}

/** --no-custom-instructions still loads COPILOT_HOME/instructions, where PAL's identity lives. */
export async function inferenceViaCopilotSpawn(
  bin: string,
  opts: InferenceOptions
): Promise<InferenceResult> {
  const spawn = (home: string, place?: SpawnPlace) =>
    inferenceViaCliSpawn(
      bin,
      buildCopilotArgs(opts),
      buildCliPrompt(opts),
      opts,
      copilotReply(home),
      place
    );
  const env = withPalEnv(process.env);
  if (!copilotLogsInWithoutHome(env))
    return spawn(env.COPILOT_HOME || platform.copilotDir());
  const dir = await mkdtemp(join(tmpdir(), "pal-copilot-"));

  try {
    return await spawn(dir, { cwd: dir, env: { COPILOT_HOME: dir } });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function copilotTools(opts: InferenceOptions): string[] {
  return opts.web
    ? ["--available-tools=web_fetch", "--allow-tool=web_fetch", "--allow-all-urls"]
    : ["--available-tools=none", "--deny-tool=url"];
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

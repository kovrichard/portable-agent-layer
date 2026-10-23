import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { agentDirOverrides, paths } from "../../src/hooks/lib/paths";
import { freshTestDir } from "./test-home";

// Every payload and transcript step below was captured from agy 1.3.1 by a hook
// that wrote its stdin to disk; only the paths are swapped for sandbox ones.

// Assembled at runtime so this file does not contain the literal pattern that
// PAL's own SecurityValidator blocks when an agent edits or greps it.
export const DANGEROUS = `${"rm -r"}${"f /"}`;

export const CONVERSATION = "40a52bef-33e9-4979-a9e4-cb99c5303691";

export const ORIGINAL_CWD = process.cwd();
export const RUNTIME_ENV = [
  "ANTIGRAVITY_CONVERSATION_ID",
  "CLAUDE_CODE_ENTRYPOINT",
  "CURSOR_AGENT",
  "CURSOR_VERSION",
  "CURSOR_INVOKED_AS",
  "CODEX_CLI_VERSION",
  "OPENAI_CODEX",
];
const savedRuntimeEnv = Object.fromEntries(RUNTIME_ENV.map((k) => [k, process.env[k]]));

interface AgySandbox {
  sandbox: string;
  workspace: string;
  transcript: string;
}

let current: AgySandbox = { sandbox: "", workspace: "", transcript: "" };

/** A fresh sandbox, PAL home and agent dirs, with the runtime env and cwd put back. */
export function freshAgySandbox(testFile: string): AgySandbox {
  process.chdir(ORIGINAL_CWD);
  for (const key of RUNTIME_ENV) {
    if (savedRuntimeEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedRuntimeEnv[key];
  }
  const sandbox = realpathSync(freshTestDir(testFile));
  const workspace = resolve(sandbox, "workspace");
  mkdirSync(workspace, { recursive: true });
  current = { sandbox, workspace, transcript: resolve(sandbox, "transcript_full.jsonl") };
  process.env.PAL_HOME = resolve(sandbox, "home");
  for (const { env } of agentDirOverrides()) process.env[env] = resolve(sandbox, env);
  delete process.env.PAL_AGENT;
  return current;
}

export function agyPayload(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    artifactDirectoryPath: `/agy/brain/${CONVERSATION}`,
    conversationId: CONVERSATION,
    modelName: "gemini-3.8-flash-medium",
    transcriptPath: current.transcript,
    workspacePaths: [current.workspace],
    ...fields,
  };
}

export function runCommand(commandLine: string) {
  return agyPayload({
    stepIdx: 7,
    toolCall: {
      args: {
        CommandLine: commandLine,
        Cwd: current.workspace,
        WaitMsBeforeAsync: 5000,
        toolAction: "Listing directory contents",
        toolSummary: "List directory",
      },
      name: "run_command",
    },
  });
}

export const preInvocation = (invocationNum: number) =>
  agyPayload({ initialNumSteps: 1 + 2 * invocationNum, invocationNum });

export const stop = (fields: Record<string, unknown> = {}) =>
  agyPayload({
    error: "",
    executionNum: 0,
    fullyIdle: true,
    terminationReason: "NO_TOOL_CALL",
    ...fields,
  });

export function userInput(request: string, source = "USER_EXPLICIT") {
  return {
    step_index: 0,
    source,
    type: "USER_INPUT",
    status: "DONE",
    created_at: "2026-10-07T14:17:46Z",
    content: `<USER_REQUEST>\n${request}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-10-07T16:17:46+02:00.\n</ADDITIONAL_METADATA>`,
  };
}

export const SUBAGENT_OPENING = {
  step_index: 0,
  source: "SYSTEM",
  type: "SYSTEM_MESSAGE",
  status: "DONE",
  created_at: "2026-10-07T14:35:36Z",
  content:
    "The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n\n<SYSTEM_MESSAGE>\n[Message] timestamp=2026-10-07T14:35:36Z sender=298eb946-5a54-496e-afdc-db3a6c882bd9 priority=MESSAGE_PRIORITY_HIGH content=Reply with your exact model ID.\n</SYSTEM_MESSAGE>",
};

export function plannerResponse(fields: Record<string, unknown>) {
  return {
    step_index: 2,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-10-07T17:43:08Z",
    input_tokens: 21491,
    cache_read_tokens: 0,
    output_tokens: 567,
    thinking: "The task involves executing a shell command.",
    ...fields,
  };
}

export const said = (content: string) => plannerResponse({ content });

export function writeTranscript(...steps: unknown[]): void {
  writeFileSync(
    current.transcript,
    steps.map((s) => JSON.stringify(s)).join("\n"),
    "utf-8"
  );
}

/** Something for the session reminder to carry, so its presence can be seen. */
function seedHandoffElsewhere(marker: string): void {
  writeFileSync(
    resolve(paths.state(), "last-handoff.json"),
    JSON.stringify({
      "/elsewhere": {
        title: "elsewhere",
        handoff: marker,
        status: "in-progress",
        timestamp: new Date().toISOString(),
      },
    }),
    "utf-8"
  );
}

export function startUserTurnUnderAgy(): void {
  process.env.PAL_AGENT = "antigravity";
  writeTranscript(userInput("fix the build"));
  seedHandoffElsewhere("SEED-NOTE-4471");
}

export const injectedText = (reply: string | null) =>
  JSON.parse(reply ?? "{}").injectSteps?.[0]?.userMessage as string | undefined;

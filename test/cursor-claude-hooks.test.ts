import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { duplicatesCursorHooks } from "../src/hooks/lib/cursor-shadow";
import { removeOnceReleased } from "./lib/remove-once-released";

// cursor-agent also runs every hook in ~/.claude/settings.json, so with PAL's
// Cursor hooks installed each Cursor prompt ran PAL twice: two logged turns, two
// rating calls, and Claude's CompactRecover replaying the last Claude exchange.

const REPO_ROOT = resolve(import.meta.dir, "..");
const HOOK = resolve(REPO_ROOT, "src/hooks/SecurityValidator.ts");

// Assembled at runtime so this file does not contain the literal pattern that
// PAL's own SecurityValidator blocks when an agent edits or greps it.
const DANGEROUS = `${"rm -r"}${"f /"}`;
const PAYLOAD = {
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: DANGEROUS },
};

const HOST_ENV_KEYS = [
  "PAL_AGENT",
  "CURSOR_AGENT",
  "CURSOR_VERSION",
  "CURSOR_INVOKED_AS",
  "CLAUDE_CODE_ENTRYPOINT",
  "CODEX_CLI_VERSION",
  "OPENAI_CODEX",
] as const;

let cursorDir: string;

beforeEach(() => {
  cursorDir = mkdtempSync(resolve(tmpdir(), "pal-cursor-shadow-"));
});

afterEach(() => {
  removeOnceReleased(cursorDir);
});

function installPalCursorHooks(): void {
  const command = `bun run /pkg/src/hooks/SecurityValidator.ts --agent=cursor`;
  writeFileSync(
    resolve(cursorDir, "hooks.json"),
    JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: "command", command }] } })
  );
}

function installUserCursorHooks(): void {
  writeFileSync(
    resolve(cursorDir, "hooks.json"),
    JSON.stringify({
      version: 1,
      hooks: { preToolUse: [{ type: "command", command: "./my-own-hook.sh" }] },
    })
  );
}

function hostEnv(host: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PAL_CURSOR_DIR: cursorDir, ...host };
  for (const key of HOST_ENV_KEYS) if (!(key in host)) delete env[key];
  return env;
}

async function runHook(agentFlag: string, host: Record<string, string>): Promise<string> {
  const proc = Bun.spawn(["bun", "run", HOOK, `--agent=${agentFlag}`], {
    stdin: new TextEncoder().encode(JSON.stringify(PAYLOAD)),
    stdout: "pipe",
    stderr: "ignore",
    env: hostEnv(host),
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

const savedArgv = process.argv;
const TOUCHED_ENV_KEYS = [...HOST_ENV_KEYS, "PAL_CURSOR_DIR"];
const savedEnv = Object.fromEntries(TOUCHED_ENV_KEYS.map((k) => [k, process.env[k]]));

// Keys are set one by one: replacing process.env with a plain object drops
// Windows' case-insensitive Path/PATH, which breaks every later spawn.
afterEach(() => {
  process.argv = savedArgv;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function inHost(agentFlag: string, host: Record<string, string>): void {
  process.argv = ["bun", "hook.ts", `--agent=${agentFlag}`];
  for (const key of HOST_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { PAL_CURSOR_DIR: cursorDir, ...host });
}

const IN_CURSOR = { CURSOR_AGENT: "1" };
const IN_CLAUDE_CODE = { CLAUDE_CODE_ENTRYPOINT: "cli" };

describe("a Claude-registered hook inside Cursor", () => {
  test("stands down when PAL's own Cursor hooks will run it", async () => {
    installPalCursorHooks();
    expect(await runHook("claude", IN_CURSOR)).toBe("");
  });

  test("is a duplicate when PAL's own Cursor hooks will run it", () => {
    installPalCursorHooks();
    inHost("claude", IN_CURSOR);
    expect(duplicatesCursorHooks()).toBe(true);
  });

  test("is not one when PAL has no Cursor hooks, since it is the only copy", () => {
    inHost("claude", IN_CURSOR);
    expect(duplicatesCursorHooks()).toBe(false);
  });

  test("is not one when Cursor's hooks are only the user's own", () => {
    installUserCursorHooks();
    inHost("claude", IN_CURSOR);
    expect(duplicatesCursorHooks()).toBe(false);
  });
});

describe("the hooks that must keep running", () => {
  test("PAL's Cursor registration inside Cursor", () => {
    installPalCursorHooks();
    inHost("cursor", IN_CURSOR);
    expect(duplicatesCursorHooks()).toBe(false);
  });

  test("the Claude registration inside Claude Code", () => {
    installPalCursorHooks();
    inHost("claude", IN_CLAUDE_CODE);
    expect(duplicatesCursorHooks()).toBe(false);
  });

  test("a hook that blocks still blocks when it is the one that runs", async () => {
    installPalCursorHooks();
    expect(await runHook("cursor", IN_CURSOR)).toContain("deny");
  });
});

describe("every hook the Claude config registers", () => {
  const template = readFileSync(
    resolve(REPO_ROOT, "assets/templates/settings.claude.json"),
    "utf-8"
  );
  const hooks = [...new Set(template.match(/src\/hooks\/\w+\.ts/g) ?? [])];

  test("is found in the template", () => {
    expect(hooks.length).toBeGreaterThan(5);
  });

  test.each(hooks)("%s checks for Cursor's own copy before doing anything", (hook) => {
    expect(readFileSync(resolve(REPO_ROOT, hook), "utf-8")).toContain(
      "if (duplicatesCursorHooks()) process.exit(0);"
    );
  });
});

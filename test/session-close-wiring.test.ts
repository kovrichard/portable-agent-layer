import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The feature is only as good as its wiring: if an agent's close event is not
// registered, that agent silently stops updating and nothing fails loudly. Each
// event name below is the one that agent's own docs give — Claude SessionEnd,
// Cursor sessionEnd, Codex SessionEnd, Copilot sessionEnd — and opencode, which
// has no session-end event, calls the library from its plugin instead.

const repo = resolve(import.meta.dir, "..");

function template(name: string): string {
  return readFileSync(resolve(repo, "assets", "templates", name), "utf-8");
}

const WIRED = [
  { agent: "claude", file: "settings.claude.json", event: "SessionEnd" },
  { agent: "cursor", file: "hooks.cursor.json", event: "sessionEnd" },
  { agent: "codex", file: "hooks.codex.json", event: "SessionEnd" },
  { agent: "copilot", file: "hooks.copilot.json", event: "sessionEnd" },
] as const;

describe("every agent applies the update when a session closes", () => {
  for (const { agent, file, event } of WIRED) {
    test(`${agent} runs SessionClose on ${event}`, () => {
      const config = JSON.parse(template(file)) as {
        hooks: Record<string, unknown>;
      };
      expect(Object.keys(config.hooks)).toContain(event);
      expect(JSON.stringify(config.hooks[event])).toContain(
        `src/hooks/SessionClose.ts --agent=${agent}`
      );
    });
  }

  test("opencode updates when its server is disposed", () => {
    const plugin = readFileSync(
      resolve(repo, "src", "targets", "opencode", "plugin.ts"),
      "utf-8"
    );
    expect(plugin).toContain('event.type === "server.instance.disposed"');
    expect(plugin).toContain("autoUpdateOnClose");
  });
});

// Claude is the one agent whose config can say this declaratively, so it does.
describe("Claude's close matcher", () => {
  test("excludes the reasons that leave the CLI running", () => {
    const settings = JSON.parse(template("settings.claude.json")) as {
      hooks: { SessionEnd: { matcher: string }[] };
    };
    const matcher = settings.hooks.SessionEnd[0].matcher;
    expect(matcher).not.toContain("clear");
    expect(matcher).not.toContain("resume");
    expect(matcher).toContain("prompt_input_exit");
  });
});

// Close is the usual path; start is the rescue for an install whose close hook
// never fires, which would otherwise sit forever on "restart to apply".
describe("opening a session", () => {
  test("uses the rescue path, never the plain daily gate", () => {
    const loadContext = readFileSync(
      resolve(repo, "src", "hooks", "LoadContext.ts"),
      "utf-8"
    );
    expect(loadContext).toContain("autoUpdateOnStart");
    expect(loadContext).not.toContain("shouldAutoUpdate");
  });
});

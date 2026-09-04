import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadCursorHooksTemplate,
  loadSettingsTemplate,
  mergeCursorHooks,
  mergeSettings,
} from "../src/targets/lib";

const templatePath = (name: string) =>
  resolve(import.meta.dir, "../assets/templates", name);

const commandsIn = (json: string) =>
  Array.from(json.matchAll(/"command":\s*"([^"]+)"/g), (m) => m[1]);

describe("templates declare their agent by flag, not shell prefix", () => {
  for (const [file, agent] of [
    ["hooks.cursor.json", "cursor"],
    ["settings.claude.json", "claude"],
  ] as const) {
    const raw = readFileSync(templatePath(file), "utf-8");

    test(`${file} uses no PAL_AGENT= prefix`, () => {
      expect(raw).not.toContain("PAL_AGENT=");
    });

    test(`${file} declares --agent=${agent} on every hook command`, () => {
      const hookCommands = commandsIn(raw).filter((c) => c.includes("/src/hooks/"));
      expect(hookCommands.length).toBeGreaterThan(0);
      for (const command of hookCommands) {
        expect(command).toContain(`--agent=${agent}`);
      }
    });

    test(`${file} puts the flag after the script path so argv carries it`, () => {
      for (const command of commandsIn(raw).filter((c) => c.includes("/src/hooks/"))) {
        expect(command.indexOf("--agent=")).toBeGreaterThan(command.indexOf(".ts"));
      }
    });
  }
});

describe("installing over a config that still has the old prefix", () => {
  test("Cursor: the old entry is replaced, not duplicated", () => {
    const template = loadCursorHooksTemplate(templatePath("hooks.cursor.json"), "/new");
    const installed = {
      version: 1,
      hooks: {
        sessionStart: [
          {
            type: "command",
            command: "PAL_AGENT=cursor bun run /old/src/hooks/LoadContext.ts",
          },
        ],
      },
    };

    const merged = mergeCursorHooks(installed, template);
    const sessionStart = merged.hooks?.sessionStart ?? [];

    expect(sessionStart).toHaveLength(1);
    expect(sessionStart[0].command).toBe(
      "bun run /new/src/hooks/LoadContext.ts --agent=cursor"
    );
    expect(JSON.stringify(merged)).not.toContain("PAL_AGENT=");
  });

  test("Claude: the old entry is replaced, not duplicated", () => {
    const template = loadSettingsTemplate(templatePath("settings.claude.json"), "/new");
    const installed = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Write|Edit",
            hooks: [
              {
                type: "command",
                command: "PAL_AGENT=claude bun run /old/src/hooks/LedgerSnapshot.ts",
              },
            ],
          },
        ],
      },
    };

    const merged = mergeSettings(installed, template);
    const snapshots = (merged.hooks?.PreToolUse ?? []).filter((e) =>
      e.hooks?.[0]?.command?.includes("LedgerSnapshot.ts")
    );

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.hooks?.[0]?.command).toContain("--agent=claude");
    expect(JSON.stringify(merged)).not.toContain("PAL_AGENT=");
  });

  test("a user's own hook survives the migration untouched", () => {
    const template = loadCursorHooksTemplate(templatePath("hooks.cursor.json"), "/new");
    const installed = {
      version: 1,
      hooks: {
        sessionStart: [
          {
            type: "command",
            command: "PAL_AGENT=cursor bun run /old/src/hooks/LoadContext.ts",
          },
          { type: "command", command: "my-own-thing.sh" },
        ],
      },
    };

    const merged = mergeCursorHooks(installed, template);
    const commands = (merged.hooks?.sessionStart ?? []).map((e) => e.command);

    expect(commands).toContain("my-own-thing.sh");
    expect(commands.filter((c) => c.includes("LoadContext.ts"))).toHaveLength(1);
  });
});

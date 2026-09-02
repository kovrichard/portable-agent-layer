import { describe, expect, test } from "bun:test";
import { mergeCursorHooks, unmergeCursorHooks } from "../src/targets/lib";

const TEMPLATE = {
  version: 1,
  hooks: {
    beforeShellExecution: [
      { type: "command", command: "bun run /pkg/src/hooks/SecurityValidator.ts" },
    ],
    stop: [
      {
        type: "command",
        command: "bun run /pkg/src/hooks/StopOrchestrator.ts",
        timeout: 30,
      },
    ],
  },
};

describe("mergeCursorHooks", () => {
  test("installs every template event into empty hooks", () => {
    const merged = mergeCursorHooks({}, TEMPLATE);

    expect(merged.version).toBe(1);
    expect(Object.keys(merged.hooks ?? {})).toEqual(["beforeShellExecution", "stop"]);
    expect(merged.hooks?.stop?.[0]?.timeout).toBe(30);
  });

  test("keeps the existing version rather than resetting it", () => {
    expect(mergeCursorHooks({ version: 2 }, TEMPLATE).version).toBe(2);
  });

  test("defaults the version to 1 when absent", () => {
    expect(mergeCursorHooks({}, {}).version).toBe(1);
  });

  test("replaces a PAL hook installed from a different package path", () => {
    const existing = {
      hooks: {
        stop: [
          { type: "command", command: "bun run /old/path/src/hooks/StopOrchestrator.ts" },
        ],
      },
    };

    const commands = (mergeCursorHooks(existing, TEMPLATE).hooks?.stop ?? []).map(
      (e) => e.command
    );

    expect(commands).toEqual(["bun run /pkg/src/hooks/StopOrchestrator.ts"]);
  });

  test("preserves a user hook on an event PAL also uses", () => {
    const existing = {
      hooks: { stop: [{ type: "command", command: "echo mine" }] },
    };

    const commands = (mergeCursorHooks(existing, TEMPLATE).hooks?.stop ?? []).map(
      (e) => e.command
    );

    expect(commands).toEqual(["echo mine", "bun run /pkg/src/hooks/StopOrchestrator.ts"]);
  });

  test("leaves hooks alone when the template has none", () => {
    const existing = {
      hooks: { stop: [{ type: "command", command: "echo mine" }] },
    };

    expect(mergeCursorHooks(existing, {}).hooks).toEqual(existing.hooks);
  });
});

describe("unmergeCursorHooks", () => {
  test("removes every hook the template installed", () => {
    const merged = mergeCursorHooks({}, TEMPLATE);

    expect(unmergeCursorHooks(merged, TEMPLATE).hooks).toBeUndefined();
  });

  test("round-trips a user hook back to its original shape", () => {
    const original = {
      version: 1,
      hooks: { stop: [{ type: "command", command: "echo mine" }] },
    };

    const merged = mergeCursorHooks(structuredClone(original), TEMPLATE);

    expect(unmergeCursorHooks(merged, TEMPLATE)).toEqual(original);
  });

  test("keeps an unrelated event intact", () => {
    const existing = {
      hooks: {
        afterFileEdit: [{ type: "command", command: "echo mine" }],
        stop: [
          {
            type: "command",
            command: "bun run /pkg/src/hooks/StopOrchestrator.ts",
            timeout: 30,
          },
        ],
      },
    };

    expect(unmergeCursorHooks(existing, TEMPLATE).hooks).toEqual({
      afterFileEdit: [{ type: "command", command: "echo mine" }],
    });
  });

  test("matches on the exact command, so an old-path PAL hook survives uninstall", () => {
    const existing = {
      hooks: {
        stop: [
          { type: "command", command: "bun run /old/path/src/hooks/StopOrchestrator.ts" },
        ],
      },
    };

    expect(unmergeCursorHooks(existing, TEMPLATE).hooks?.stop).toHaveLength(1);
  });

  test("leaves hooks alone when the template has none", () => {
    const existing = {
      hooks: { stop: [{ type: "command", command: "echo mine" }] },
    };

    expect(unmergeCursorHooks(existing, {}).hooks).toEqual(existing.hooks);
  });
});

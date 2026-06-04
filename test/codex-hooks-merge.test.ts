import { describe, expect, test } from "bun:test";
import { mergeCodexHooks } from "../src/targets/lib";

function makeTemplate(pkgRoot: string) {
  return {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: `PAL_AGENT=codex bun run ${pkgRoot}/src/hooks/LoadContext.ts`,
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `PAL_AGENT=codex bun run ${pkgRoot}/src/hooks/UserPromptOrchestrator.ts`,
            },
          ],
        },
      ],
    },
  };
}

describe("mergeCodexHooks — path migration", () => {
  test("reinstall from path B removes path A entries, leaves only path B", () => {
    const templateA = makeTemplate("/private/tmp/pal-test-abc123");
    const templateB = makeTemplate("/home/user/.local/share/pal");

    const userHook = {
      hooks: [{ type: "command", command: "echo user-hook" }],
    };

    const withA = mergeCodexHooks({ hooks: { SessionStart: [userHook] } }, templateA);
    const withB = mergeCodexHooks(withA, templateB);

    // Path A entries gone
    const sessionStart = withB.hooks?.SessionStart ?? [];
    const cmds = sessionStart.flatMap((g) => (g.hooks ?? []).map((h) => h.command));
    expect(cmds.some((c) => c.includes("tmp/pal-test-abc123"))).toBe(false);

    // Path B entries present
    expect(cmds.some((c) => c.includes(".local/share/pal"))).toBe(true);

    // User hook preserved
    expect(
      sessionStart.some((g) =>
        (g.hooks ?? []).some((h) => h.command === "echo user-hook")
      )
    ).toBe(true);
  });

  test("same-path reinstall is idempotent — one entry per event", () => {
    const template = makeTemplate("/home/user/pal");

    const once = mergeCodexHooks({}, template);
    const twice = mergeCodexHooks(once, template);

    for (const [event, groups] of Object.entries(twice.hooks ?? {})) {
      const cmds = groups.flatMap((g) => (g.hooks ?? []).map((h) => h.command));
      const palCmds = cmds.filter((c) => c.includes("/src/hooks/"));
      expect(palCmds.length).toBe(1);
      void event;
    }
  });

  test("user hooks not removed during migration", () => {
    const templateA = makeTemplate("/old/path");
    const templateB = makeTemplate("/new/path");
    const userHook = { hooks: [{ type: "command", command: "my-custom-tool --check" }] };

    const existing = { hooks: { PreToolUse: [userHook] } };
    const result = mergeCodexHooks(mergeCodexHooks(existing, templateA), templateB);

    const preToolHooks = result.hooks?.PreToolUse ?? [];
    expect(
      preToolHooks.some((g) =>
        (g.hooks ?? []).some((h) => h.command === "my-custom-tool --check")
      )
    ).toBe(true);
  });
});

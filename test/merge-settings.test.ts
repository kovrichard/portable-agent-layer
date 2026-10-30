import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadSettingsTemplate, mergeSettings, unmergeSettings } from "../src/targets/lib";

const PAL_TEMPLATE = {
  hooks: {
    SessionStart: [
      {
        hooks: [{ type: "command", command: "bun run /pkg/src/hooks/LoadContext.ts" }],
      },
    ],
    Stop: [
      {
        matcher: "*",
        hooks: [
          { type: "command", command: "bun run /pkg/src/hooks/StopOrchestrator.ts" },
        ],
      },
    ],
  },
  permissions: { allow: ["Read(//*)", "Bash(bun run test *)"] },
  skillOverrides: { telos: { enabled: true } },
  attribution: { commit: "Co-authored by Atlas", pr: "Co-authored by [Atlas]" },
  showClearContextOnPlanAccept: true,
  respectGitignore: false,
  spinnerTipsEnabled: false,
  spinnerTipsOverride: { tips: ["pal tip one", "pal tip two"] },
};

describe("mergeSettings", () => {
  test("adds every template section to empty settings", () => {
    const merged = mergeSettings({}, PAL_TEMPLATE);

    expect(Object.keys(merged.hooks ?? {})).toEqual(["SessionStart", "Stop"]);
    expect(merged.permissions?.allow).toEqual(["Read(//*)", "Bash(bun run test *)"]);
    expect(merged.skillOverrides).toEqual({ telos: { enabled: true } });
    expect(merged.attribution).toEqual(PAL_TEMPLATE.attribution);
    expect(merged.showClearContextOnPlanAccept).toBe(true);
    expect(merged.respectGitignore).toBe(false);
    expect(merged.spinnerTipsEnabled).toBe(false);
    expect(merged.spinnerTipsOverride).toEqual({ tips: ["pal tip one", "pal tip two"] });
  });

  test("a fresh install receives every setting the shipped template carries", () => {
    const shipped = loadSettingsTemplate(
      resolve(import.meta.dir, "../assets/templates/settings.claude.json"),
      "/pkg"
    );
    const merged = mergeSettings({}, shipped);
    for (const key of Object.keys(shipped)) expect(merged).toHaveProperty(key);
  });

  test("turns off Claude's own memory, but not over a user's choice", () => {
    const template = { autoMemoryEnabled: false };
    expect(mergeSettings({}, template).autoMemoryEnabled).toBe(false);
    expect(mergeSettings({ autoMemoryEnabled: true }, template).autoMemoryEnabled).toBe(
      true
    );
  });

  test("replaces a PAL hook installed from a different package path", () => {
    const existing = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "bun run /old/path/src/hooks/LoadContext.ts" },
            ],
          },
        ],
      },
    };

    const merged = mergeSettings(existing, PAL_TEMPLATE);
    const commands = (merged.hooks?.SessionStart ?? []).map((e) => e.hooks?.[0]?.command);

    expect(commands).toEqual(["bun run /pkg/src/hooks/LoadContext.ts"]);
  });

  test("strips a leading env assignment when comparing hook commands", () => {
    const existing = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "PAL_DEBUG=1 bun run /old/src/hooks/LoadContext.ts",
              },
            ],
          },
        ],
      },
    };

    const merged = mergeSettings(existing, PAL_TEMPLATE);

    expect(merged.hooks?.SessionStart).toHaveLength(1);
  });

  test("preserves a user hook on an event PAL also uses", () => {
    const existing = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }],
      },
    };

    const merged = mergeSettings(existing, PAL_TEMPLATE);
    const commands = (merged.hooks?.Stop ?? []).map((e) => e.hooks?.[0]?.command);

    expect(commands).toContain("echo mine");
    expect(commands).toContain("bun run /pkg/src/hooks/StopOrchestrator.ts");
  });

  test("keeps a user permission and adds template permissions once", () => {
    const existing = {
      permissions: { allow: ["WebFetch", "Read(//*)"] },
    };

    const merged = mergeSettings(existing, PAL_TEMPLATE);

    expect(merged.permissions?.allow).toEqual([
      "WebFetch",
      "Read(//*)",
      "Bash(bun run test *)",
    ]);
  });

  test("keeps the user value for every key the template also sets", () => {
    const existing = {
      skillOverrides: { telos: { enabled: false } },
      attribution: { commit: "mine", pr: "mine" },
      showClearContextOnPlanAccept: false,
      respectGitignore: true,
      spinnerTipsEnabled: true,
    };

    const merged = mergeSettings(existing, PAL_TEMPLATE);

    expect(merged.skillOverrides).toEqual({ telos: { enabled: false } });
    expect(merged.attribution).toEqual({ commit: "mine", pr: "mine" });
    expect(merged.showClearContextOnPlanAccept).toBe(false);
    expect(merged.respectGitignore).toBe(true);
    expect(merged.spinnerTipsEnabled).toBe(true);
  });

  test("appends template tips after user tips without duplicating", () => {
    const existing = {
      spinnerTipsOverride: { tips: ["mine", "pal tip one"] },
    };

    const merged = mergeSettings(existing, PAL_TEMPLATE);

    expect((merged.spinnerTipsOverride as { tips: string[] }).tips).toEqual([
      "mine",
      "pal tip one",
      "pal tip two",
    ]);
  });

  test("leaves settings untouched when the template is empty", () => {
    const existing = {
      permissions: { allow: ["WebFetch"] },
      editorMode: "vim",
    };

    expect(mergeSettings(existing, {})).toEqual(existing);
  });
});

describe("unmergeSettings", () => {
  test("removes every template section it installed", () => {
    const merged = mergeSettings({}, PAL_TEMPLATE);
    const cleaned = unmergeSettings(merged, PAL_TEMPLATE);

    expect(cleaned.hooks).toBeUndefined();
    expect(cleaned.permissions).toBeUndefined();
    expect(cleaned.skillOverrides).toBeUndefined();
    expect(cleaned.attribution).toBeUndefined();
    expect(cleaned.showClearContextOnPlanAccept).toBeUndefined();
    expect(cleaned.respectGitignore).toBeUndefined();
    expect(cleaned.spinnerTipsEnabled).toBeUndefined();
    expect(cleaned.spinnerTipsOverride).toBeUndefined();
  });

  test("uninstalling gives Claude its own memory back", () => {
    const template = { autoMemoryEnabled: false };
    const cleaned = unmergeSettings(mergeSettings({}, template), template);
    expect(cleaned).not.toHaveProperty("autoMemoryEnabled");
  });

  test("round-trips user settings back to their original shape", () => {
    const original = {
      editorMode: "vim",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }],
      },
      permissions: { allow: ["WebFetch"] },
      skillOverrides: { mine: { enabled: true } },
      spinnerTipsOverride: { tips: ["mine"] },
    };

    const merged = mergeSettings(structuredClone(original), PAL_TEMPLATE);
    const cleaned = unmergeSettings(merged, PAL_TEMPLATE);

    expect(cleaned).toEqual(original);
  });

  test("drops an event whose only entry was a PAL hook", () => {
    const merged = mergeSettings({}, PAL_TEMPLATE);
    const cleaned = unmergeSettings(merged, PAL_TEMPLATE);

    expect(cleaned.hooks).toBeUndefined();
  });

  test("removes a PAL hook installed from a different package path", () => {
    const existing = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "bun run /old/path/src/hooks/LoadContext.ts" },
            ],
          },
        ],
      },
    };

    expect(unmergeSettings(existing, PAL_TEMPLATE).hooks).toBeUndefined();
  });

  test("keeps a user permission while removing the template ones", () => {
    const existing = {
      permissions: { allow: ["WebFetch", "Read(//*)", "Bash(bun run test *)"] },
    };

    expect(unmergeSettings(existing, PAL_TEMPLATE).permissions?.allow).toEqual([
      "WebFetch",
    ]);
  });

  test("keeps a user skill override while removing the template ones", () => {
    const existing = {
      skillOverrides: { telos: { enabled: true }, mine: { enabled: true } },
    };

    expect(unmergeSettings(existing, PAL_TEMPLATE).skillOverrides).toEqual({
      mine: { enabled: true },
    });
  });

  test("keeps user tips while removing the template tips", () => {
    const existing = {
      spinnerTipsOverride: { tips: ["mine", "pal tip one", "pal tip two"] },
    };

    expect(unmergeSettings(existing, PAL_TEMPLATE).spinnerTipsOverride).toEqual({
      tips: ["mine"],
    });
  });

  test("leaves settings untouched when the template is empty", () => {
    const existing = {
      permissions: { allow: ["WebFetch"] },
      editorMode: "vim",
    };

    expect(unmergeSettings(existing, {})).toEqual(existing);
  });
});

describe("the Antigravity command allowlist", () => {
  const shippedAllow = (name: string) =>
    loadSettingsTemplate(resolve(import.meta.dir, "../assets/templates", name), "/pkg")
      .permissions?.allow ?? [];

  function fixedPrefixCommands(claudeAllow: string[]): string[] {
    return claudeAllow.flatMap((rule) => {
      const prefix = /^Bash\((.+?) (?:\/\/)?\*\)$/.exec(rule)?.[1];
      return prefix && !prefix.includes("*") ? [prefix] : [];
    });
  }

  test("grants every fixed-prefix command Claude's allowlist grants, and nothing else", () => {
    const expected = fixedPrefixCommands(shippedAllow("settings.claude.json"));
    expect(expected).toContain("grep");
    expect(expected).toContain("pal cli project");
    expect(shippedAllow("settings.antigravity.json")).toEqual(
      expected.map((prefix) => `command(${prefix})`)
    );
  });
});

describe("PAL's plugin marketplace", () => {
  const marketplace = (path: string) => ({
    pal: { source: { source: "directory", path } },
  });
  const template = {
    extraKnownMarketplaces: marketplace("/pkg"),
    enabledPlugins: { "dark-factory@pal": true },
  };

  test("the shipped template registers the package as a marketplace with dark-factory off", () => {
    const shipped = loadSettingsTemplate(
      resolve(import.meta.dir, "../assets/templates/settings.claude.json"),
      "/pkg"
    );
    expect(shipped.extraKnownMarketplaces).toEqual(marketplace("/pkg"));
    expect(shipped.enabledPlugins).toEqual({ "dark-factory@pal": false });
  });

  test("install adds the marketplace and the plugin beside the user's own", () => {
    const merged = mergeSettings(
      {
        extraKnownMarketplaces: { mine: { source: { source: "github", repo: "a/b" } } },
        enabledPlugins: { "other@mine": true },
      },
      template
    );
    expect(merged.extraKnownMarketplaces).toEqual({
      mine: { source: { source: "github", repo: "a/b" } },
      ...marketplace("/pkg"),
    });
    expect(merged.enabledPlugins).toEqual({
      "other@mine": true,
      "dark-factory@pal": true,
    });
  });

  test("reinstalling from another location moves the marketplace to the new path", () => {
    const merged = mergeSettings(
      { extraKnownMarketplaces: marketplace("/old") },
      template
    );
    expect(merged.extraKnownMarketplaces).toEqual(marketplace("/pkg"));
  });

  test("a user who disabled dark-factory keeps it disabled", () => {
    const merged = mergeSettings(
      { enabledPlugins: { "dark-factory@pal": false } },
      template
    );
    expect(merged.enabledPlugins).toEqual({ "dark-factory@pal": false });
  });

  test("uninstall removes only PAL's entries", () => {
    const cleaned = unmergeSettings(
      {
        extraKnownMarketplaces: {
          ...marketplace("/pkg"),
          mine: { source: { source: "github", repo: "a/b" } },
        },
        enabledPlugins: { "dark-factory@pal": true, "other@mine": true },
      },
      template
    );
    expect(cleaned.extraKnownMarketplaces).toEqual({
      mine: { source: { source: "github", repo: "a/b" } },
    });
    expect(cleaned.enabledPlugins).toEqual({ "other@mine": true });
  });

  test("uninstall drops the keys once nothing else is left in them", () => {
    const cleaned = unmergeSettings(mergeSettings({}, template), template);
    expect(cleaned).not.toHaveProperty("extraKnownMarketplaces");
    expect(cleaned).not.toHaveProperty("enabledPlugins");
  });
});

describe("env variables from the settings template", () => {
  const template = { env: { DARK_FACTORY_HOME: "/home/pal/dark-factory" } };

  test("install adds the variable beside the user's own", () => {
    const merged = mergeSettings({ env: { EDITOR: "vim" } }, template);
    expect(merged.env).toEqual({
      EDITOR: "vim",
      DARK_FACTORY_HOME: "/home/pal/dark-factory",
    });
  });

  test("a user who moved the factory keeps their location", () => {
    const merged = mergeSettings({ env: { DARK_FACTORY_HOME: "/elsewhere" } }, template);
    expect(merged.env).toEqual({ DARK_FACTORY_HOME: "/elsewhere" });
  });

  test("uninstall removes only PAL's variable", () => {
    const cleaned = unmergeSettings(
      { env: { EDITOR: "vim", DARK_FACTORY_HOME: "/home/pal/dark-factory" } },
      template
    );
    expect(cleaned.env).toEqual({ EDITOR: "vim" });
  });
});

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadSettingsTemplate } from "../src/targets/lib";

const PKG = resolve(import.meta.dir, "..");
const TEMPLATE = resolve(PKG, "assets/templates/settings.claude.json");

describe("the Claude Code settings template", () => {
  const settings = loadSettingsTemplate(TEMPLATE, PKG) as {
    env?: Record<string, string>;
    enabledPlugins?: Record<string, boolean>;
    extraKnownMarketplaces?: Record<string, unknown>;
  };

  test("leaves the dark-factory home to the factory's own default", () => {
    expect(settings.env?.DARK_FACTORY_HOME).toBeUndefined();
  });

  test("still registers the pal marketplace and enables the dark-factory plugin", () => {
    expect(settings.extraKnownMarketplaces?.pal).toBeDefined();
    expect(settings.enabledPlugins?.["dark-factory@pal"]).toBe(true);
  });
});

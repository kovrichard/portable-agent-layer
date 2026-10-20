import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as stamp from "../src/tools/dark-factory/stamp";
import {
  FACTORY_MODELS,
  PLUGIN_DIR,
  ROLE_TIERS,
  stampAgent,
  stampedFiles,
} from "../src/tools/dark-factory/stamp";

const stampTierModels = (content: string, models: Record<string, string>): string =>
  (
    stamp as unknown as {
      stampTierModels: (content: string, models: Record<string, string>) => string;
    }
  ).stampTierModels(content, models);

describe("dark-factory model stamping", () => {
  test("the committed plugin files carry the stamped model names", () => {
    for (const [path, stamped] of stampedFiles()) {
      expect({ path, content: readFileSync(path, "utf8") }).toEqual({
        path,
        content: stamped,
      });
    }
  });

  test("every agent file has a tier and every tier has an agent file", () => {
    const agents = readdirSync(join(PLUGIN_DIR, "agents")).map((file) =>
      file.replace(/\.md$/, "")
    );
    expect(agents.sort()).toEqual(Object.keys(ROLE_TIERS).sort());
  });

  test("an agent's model line is replaced with its tier's model", () => {
    const stale = "---\nname: planner\nmodel: some-old-model\n---\nbody\n";
    expect(stampAgent(stale, FACTORY_MODELS.large)).toBe(
      `---\nname: planner\nmodel: ${FACTORY_MODELS.large}\n---\nbody\n`
    );
  });

  test("the orchestrator's TIER_MODELS block is replaced with every tier's model", () => {
    const stale =
      'const A = 1;\nexport const TIER_MODELS = {\n  small: "x",\n};\nconst B = 2;\n';
    expect(stampTierModels(stale, { small: "s", medium: "m", large: "l" })).toBe(
      'const A = 1;\nexport const TIER_MODELS = {\n  small: "s",\n  medium: "m",\n  large: "l",\n};\nconst B = 2;\n'
    );
  });

  test("a file without a place to stamp is refused, not silently left alone", () => {
    expect(() => stampAgent("---\nname: x\n---\n", "m")).toThrow("no model line");
    expect(() => stampTierModels("const X = 1;\n", FACTORY_MODELS)).toThrow(
      "no TIER_MODELS constant"
    );
  });

  test("the factory never uses a flagship model", () => {
    expect(Object.keys(FACTORY_MODELS).sort()).toEqual(["large", "medium", "small"]);
  });
});

import { describe, expect, test } from "bun:test";
import {
  CONFIG_PATH,
  changedSubprojects,
  parseGateOptions,
  parseSubprojectConfig,
  subprojectDirs,
} from "../.agents/scripts/check-subprojects";

describe("subprojectDirs", () => {
  test("names every nested bun.lock folder and leaves out the root", () => {
    expect(
      subprojectDirs([
        "bun.lock",
        "package.json",
        "a/template/bun.lock",
        "a/template/package.json",
        "b/c/d/bun.lock",
      ])
    ).toEqual(["a/template", "b/c/d"]);
  });
});

describe("changedSubprojects", () => {
  const projects = ["a/template", "b/app"];
  const config = { "a/template": { overlays: ["a/demo"] } };

  test("selects only the project a changed path sits in", () => {
    expect(changedSubprojects(projects, config, ["b/app/src/x.ts", "src/y.ts"])).toEqual([
      "b/app",
    ]);
  });

  test("selects a project when only its overlay changed", () => {
    expect(changedSubprojects(projects, config, ["a/demo/lib/data.ts"])).toEqual([
      "a/template",
    ]);
  });

  test("selects nothing when only root files changed", () => {
    expect(changedSubprojects(projects, config, ["package.json", "a/README.md"])).toEqual(
      []
    );
  });

  test("does not mistake a sibling folder sharing the name prefix for the project", () => {
    expect(changedSubprojects(projects, config, ["a/template-old/x.ts"])).toEqual([]);
  });

  test("selects every project when the overlay config itself changed", () => {
    expect(changedSubprojects(projects, config, [CONFIG_PATH])).toEqual(projects);
  });
});

describe("parseSubprojectConfig", () => {
  test("reads overlays and knip settings per project", () => {
    const text = JSON.stringify({
      "a/template": { overlays: ["a/demo"], knip: { entry: ["lib/*.ts"] } },
    });
    expect(parseSubprojectConfig(text, ["a/template"])).toEqual({
      "a/template": { overlays: ["a/demo"], knip: { entry: ["lib/*.ts"] } },
    });
  });

  test("rejects a project folder that has no bun.lock", () => {
    const text = JSON.stringify({ "a/gone": { overlays: ["a/demo"] } });
    expect(() => parseSubprojectConfig(text, ["a/template"])).toThrow("a/gone");
  });

  test("rejects a misspelled setting instead of ignoring it", () => {
    const text = JSON.stringify({ "a/template": { overlay: ["a/demo"] } });
    expect(() => parseSubprojectConfig(text, ["a/template"])).toThrow();
  });

  test("rejects an overlay that is not a folder path", () => {
    const text = JSON.stringify({ "a/template": { overlays: [42] } });
    expect(() => parseSubprojectConfig(text, ["a/template"])).toThrow();
  });
});

describe("parseGateOptions", () => {
  test("reads --build and --changed independently", () => {
    expect(parseGateOptions([])).toEqual({ build: false, changedOnly: false });
    expect(parseGateOptions(["--build"])).toEqual({ build: true, changedOnly: false });
    expect(parseGateOptions(["--changed"])).toEqual({ build: false, changedOnly: true });
  });
});

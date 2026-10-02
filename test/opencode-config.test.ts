import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  opencodeBackgroundModel,
  writeInstructionFreeConfig,
} from "../src/hooks/lib/opencode-config";

const savedDir = process.env.PAL_OPENCODE_DIR;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), "pal-opencode-model-"));
  process.env.PAL_OPENCODE_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (savedDir === undefined) delete process.env.PAL_OPENCODE_DIR;
  else process.env.PAL_OPENCODE_DIR = savedDir;
});

describe("the model opencode runs PAL's background inference with", () => {
  test("is the model pinned in the config PAL installs into", () => {
    writeFileSync(resolve(dir, "config.json"), JSON.stringify({ model: "acme/fast" }));
    expect(opencodeBackgroundModel()).toBe("acme/fast");
  });

  test("is found in the user's own opencode.jsonc, comments and all", () => {
    writeFileSync(resolve(dir, "config.json"), JSON.stringify({ instructions: [] }));
    writeFileSync(
      resolve(dir, "opencode.jsonc"),
      `{\n  // pinned for background runs\n  "model": "acme/fast",\n}`
    );
    expect(opencodeBackgroundModel()).toBe("acme/fast");
  });

  test("is not pinned when no config names one", () => {
    writeFileSync(resolve(dir, "config.json"), JSON.stringify({ instructions: [] }));
    expect(opencodeBackgroundModel()).toBeNull();
  });

  test("is not pinned when there is no config at all", () => {
    expect(opencodeBackgroundModel()).toBeNull();
  });
});

describe("the config a background opencode run gets", () => {
  let configHome: string;

  beforeEach(() => {
    configHome = mkdtempSync(resolve(tmpdir(), "pal-opencode-bg-"));
  });

  afterEach(() => {
    rmSync(configHome, { recursive: true, force: true });
  });

  function backgroundFile(name: string): unknown {
    return JSON.parse(readFileSync(resolve(configHome, "opencode", name), "utf-8"));
  }

  test("keeps the user's model and providers without their instructions", () => {
    writeFileSync(
      resolve(dir, "config.json"),
      JSON.stringify({
        model: "acme/fast",
        provider: { acme: { options: { baseURL: "https://acme.test" } } },
        instructions: ["/memory/self-model.md"],
      })
    );
    writeInstructionFreeConfig(configHome);
    expect(backgroundFile("config.json")).toEqual({
      model: "acme/fast",
      provider: { acme: { options: { baseURL: "https://acme.test" } } },
    });
  });

  test("strips instructions from every config file opencode reads", () => {
    writeFileSync(
      resolve(dir, "opencode.json"),
      JSON.stringify({ instructions: ["a.md"] })
    );
    writeFileSync(
      resolve(dir, "opencode.jsonc"),
      `{\n  // personal rules\n  "instructions": ["b.md"],\n  "small_model": "acme/tiny",\n}`
    );
    writeInstructionFreeConfig(configHome);
    expect(backgroundFile("opencode.json")).toEqual({});
    expect(backgroundFile("opencode.jsonc")).toEqual({ small_model: "acme/tiny" });
  });

  test("leaves out the global AGENTS.md", () => {
    writeFileSync(resolve(dir, "config.json"), JSON.stringify({ model: "acme/fast" }));
    writeFileSync(resolve(dir, "AGENTS.md"), "# Identity\nAlways answer in a header.");
    writeInstructionFreeConfig(configHome);
    expect(readdirSync(resolve(configHome, "opencode"))).toEqual(["config.json"]);
  });
});

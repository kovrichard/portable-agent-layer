import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { opencodeBackgroundModel } from "../src/hooks/lib/opencode-config";

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

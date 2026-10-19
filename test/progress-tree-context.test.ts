import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent } from "../src/hooks/lib/progress-tree";
import {
  loadProgressTreeContext,
  progressTreePromptLine,
} from "../src/hooks/lib/progress-tree-context";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

let home: string;
let folder: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  folder = resolve(home, "some-folder");
  mkdirSync(folder, { recursive: true });
  process.env.PAL_HOME = home;
  setProgressTree(true);
});

function setProgressTree(on: boolean | undefined) {
  mkdirSync(resolve(home, "memory"), { recursive: true });
  writeFileSync(
    resolve(home, "memory", "pal-settings.json"),
    JSON.stringify({ dynamicContext: { workTree: on } })
  );
  reload();
}

describe("progress tree in context", () => {
  test("a folder outside every project is its own scope", () => {
    appendEvent(folder, "n1", "open", { title: "Loose work", parent: null });
    expect(loadProgressTreeContext(folder)).toContain("Active: Loose work [n1]");
    expect(progressTreePromptLine("go on", folder)).toBe(
      "<system-reminder>Progress: Loose work [n1] — no stopped-at recorded · 0 parked</system-reminder>"
    );
  });

  test("a folder with no work adds nothing", () => {
    expect(loadProgressTreeContext(folder)).toBe("");
    expect(progressTreePromptLine("go on", folder)).toBeNull();
  });

  test("a prompt that names a new topic carries the park-and-open hint", () => {
    appendEvent(folder, "n1", "open", { title: "Loose work", parent: null });
    expect(progressTreePromptLine("new topic: the canvas", folder)).toContain(
      "pal cli progress park --stopped"
    );
    expect(progressTreePromptLine("go on", folder)).not.toContain("park --stopped");
  });

  test.each([
    ["turned off", false],
    ["never opted into", undefined],
  ])("%s, it silences both", (_, on) => {
    appendEvent(folder, "n1", "open", { title: "Loose work", parent: null });
    setProgressTree(on);
    expect(loadProgressTreeContext(folder)).toBe("");
    expect(progressTreePromptLine("go on", folder)).toBeNull();
  });
});

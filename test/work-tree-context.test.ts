import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/hooks/lib/settings";
import { appendEvent } from "../src/hooks/lib/work-tree";
import {
  loadWorkTreeContext,
  workTreePromptLine,
} from "../src/hooks/lib/work-tree-context";
import { freshTestDir } from "./lib/test-home";

let home: string;
let folder: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  folder = resolve(home, "some-folder");
  mkdirSync(folder, { recursive: true });
  process.env.PAL_HOME = home;
  setWorkTree(true);
});

function setWorkTree(on: boolean | undefined) {
  mkdirSync(resolve(home, "memory"), { recursive: true });
  writeFileSync(
    resolve(home, "memory", "pal-settings.json"),
    JSON.stringify({ dynamicContext: { workTree: on } })
  );
  reload();
}

describe("work tree in context", () => {
  test("a folder outside every project is its own scope", () => {
    appendEvent(folder, "n1", "open", { title: "Loose work", parent: null });
    expect(loadWorkTreeContext(folder)).toContain("Active: Loose work [n1]");
    expect(workTreePromptLine("go on", folder)).toBe(
      "<system-reminder>Work: Loose work [n1] — no stopped-at recorded · 0 parked</system-reminder>"
    );
  });

  test("a folder with no work adds nothing", () => {
    expect(loadWorkTreeContext(folder)).toBe("");
    expect(workTreePromptLine("go on", folder)).toBeNull();
  });

  test("a prompt that names a new topic carries the park-and-open hint", () => {
    appendEvent(folder, "n1", "open", { title: "Loose work", parent: null });
    expect(workTreePromptLine("new topic: the canvas", folder)).toContain(
      "pal cli work park --stopped"
    );
    expect(workTreePromptLine("go on", folder)).not.toContain("park --stopped");
  });

  test.each([
    ["turned off", false],
    ["never opted into", undefined],
  ])("%s, it silences both", (_, on) => {
    appendEvent(folder, "n1", "open", { title: "Loose work", parent: null });
    setWorkTree(on);
    expect(loadWorkTreeContext(folder)).toBe("");
    expect(workTreePromptLine("go on", folder)).toBeNull();
  });
});

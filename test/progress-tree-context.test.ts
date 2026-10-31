import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent } from "../src/hooks/lib/progress-tree";
import {
  loadProgressTreeContext,
  progressTreePromptLine,
} from "../src/hooks/lib/progress-tree-context";
import type { GhRunner } from "../src/hooks/lib/progress-tree-prs";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

let home: string;
let folder: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  folder = resolve(home, "some-folder");
  mkdirSync(folder, { recursive: true });
  process.env.PAL_HOME = home;
  reload();
});

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

  describe("a session start settles the PRs attached to open nodes", () => {
    const prRef = "https://github.com/o/r/pull/126";

    function openNodeWithMergedPr() {
      appendEvent(folder, "n1", "open", { title: "Loose work", parent: null });
      appendEvent(folder, "n1", "attach", { kind: "pr", ref: prRef });
    }

    function recordingGh(calls: string[]): GhRunner {
      return (ref) => {
        calls.push(ref);
        return JSON.stringify({
          state: "MERGED",
          mergedAt: "2026-10-19T14:00:00Z",
          closedAt: "2026-10-19T14:00:00Z",
        });
      };
    }

    test("a session start shows the merged PR on its node", () => {
      openNodeWithMergedPr();
      const context = loadProgressTreeContext(folder, undefined, recordingGh([]));
      expect(context).toContain("PR #126 merged 2026-10-19");
    });
  });
});

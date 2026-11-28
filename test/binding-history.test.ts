import { beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { appendEvent } from "../src/bronze/events";
import { v20BindingsIntoBronze } from "../src/cli/migrations/v20-bindings-into-bronze";
import { bindingsFilePath, readBindings } from "../src/core/project-bindings";
import {
  adoptBindingsFile,
  bindingDrift,
  hasBindingHistory,
  rebuildBindingsFile,
  replayedBindings,
} from "../src/progress/binding-history";
import { writeBinding, writeBindings } from "../src/progress/bindings";
import { freshTestDir } from "./lib/test-home";

let HOME: string;

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
});

/** A write that never went through writeBindings, as a hand edit or a stray test does. */
function overwriteBehindPalsBack(bindings: Record<string, string>): void {
  writeFileSync(bindingsFilePath(HOME), JSON.stringify(bindings));
}

describe("replaying this machine's binding events", () => {
  test("follows binds, moves and unbinds in order", () => {
    writeBinding("alpha", "/w/a", HOME);
    writeBinding("beta", "/w/b", HOME);
    writeBinding("alpha", "/w/a2", HOME);
    writeBindings({ alpha: "/w/a2" }, HOME);

    expect(replayedBindings(HOME)).toEqual({ alpha: "/w/a2" });
  });

  test("leaves out another machine's events", () => {
    appendEvent(
      "project",
      { change: "bound" },
      {
        project: "theirs",
        content: { path: "/elsewhere" },
        attribution: { machine: "other" },
      }
    );

    expect(replayedBindings(HOME)).toEqual({});
    expect(hasBindingHistory(HOME)).toBe(false);
  });
});

describe("a bindings.json written behind PAL's back", () => {
  test("shows as drift, and rebuild restores what the history holds", () => {
    writeBindings({ "portable-agent-layer": "/w/pal", klint: "/w/klint" }, HOME);
    overwriteBehindPalsBack({ alpha: "/x" });

    expect(
      bindingDrift(HOME)
        .map((d) => d.project)
        .sort()
    ).toEqual(["alpha", "klint", "portable-agent-layer"]);
    rebuildBindingsFile(HOME);
    expect(readBindings(HOME)).toEqual({
      "portable-agent-layer": "/w/pal",
      klint: "/w/klint",
    });
    expect(bindingDrift(HOME)).toEqual([]);
  });

  test("adopt keeps the file and records it, so the drift is gone", () => {
    writeBindings({ alpha: "/w/a" }, HOME);
    overwriteBehindPalsBack({ alpha: "/w/a", beta: "/w/b" });

    expect(adoptBindingsFile(HOME)).toEqual([
      { project: "beta", change: "bound", path: "/w/b" },
    ]);
    expect(readBindings(HOME)).toEqual({ alpha: "/w/a", beta: "/w/b" });
    expect(bindingDrift(HOME)).toEqual([]);
  });
});

describe("v20-bindings-into-bronze", () => {
  test("records bindings that predate the history once, then has nothing to do", () => {
    overwriteBehindPalsBack({ alpha: "/w/a", beta: "/w/b" });

    expect(v20BindingsIntoBronze.check().pending).toBe(true);
    expect(v20BindingsIntoBronze.run().results).toEqual(["recorded 2 binding(s)"]);
    expect(replayedBindings(HOME)).toEqual({ alpha: "/w/a", beta: "/w/b" });
    expect(v20BindingsIntoBronze.check().pending).toBe(false);
  });

  test("a dry run records nothing", () => {
    overwriteBehindPalsBack({ alpha: "/w/a" });

    expect(v20BindingsIntoBronze.run(true).results).toEqual([
      "would record 1 binding(s)",
    ]);
    expect(hasBindingHistory(HOME)).toBe(false);
  });
});

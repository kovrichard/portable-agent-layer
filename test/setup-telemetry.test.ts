import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import * as clack from "@clack/prompts";
import { noticeTelemetry } from "../src/cli/setup-telemetry";
import { raw as rawSettings, reload, write } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

const originalIsTTY = process.stdin.isTTY;

function setTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

function shownNotes(): { notes: unknown[][]; restore: () => void } {
  const notes: unknown[][] = [];
  const note = spyOn(clack, "note").mockImplementation((...args) => {
    notes.push(args);
  });
  const info = spyOn(clack.log, "info").mockImplementation((...args) => {
    notes.push(args);
  });

  return {
    notes,
    restore: () => {
      note.mockRestore();
      info.mockRestore();
    },
  };
}

beforeEach(() => {
  setTTY(originalIsTTY);
  const home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("the telemetry notice at install", () => {
  test("is shown once in a terminal, with how to turn it off", async () => {
    setTTY(true);
    const { notes, restore } = shownNotes();

    try {
      expect(await noticeTelemetry()).toBe(true);
    } finally {
      restore();
    }

    expect(notes[0][1]).toBe("Anonymous usage count");
    expect(String(notes[0][0])).toContain("pal cli telemetry show");
    expect(notes[1]).toEqual(["Turn it off any time: pal cli telemetry off"]);
    expect(rawSettings().telemetry).toEqual({ noticeShown: true });
  });

  test("keeps the rest of the telemetry setting", async () => {
    setTTY(true);
    write({ telemetry: { enabled: false } });
    reload();
    const { restore } = shownNotes();

    try {
      await noticeTelemetry();
    } finally {
      restore();
    }

    expect(rawSettings().telemetry).toEqual({ enabled: false, noticeShown: true });
  });

  test("is not shown again", async () => {
    setTTY(true);
    write({ telemetry: { noticeShown: true } });
    reload();
    const { notes, restore } = shownNotes();

    try {
      expect(await noticeTelemetry()).toBe(false);
    } finally {
      restore();
    }

    expect(notes).toEqual([]);
  });

  test("without a terminal it counts as not shown", async () => {
    setTTY(undefined);
    const { notes, restore } = shownNotes();

    try {
      expect(await noticeTelemetry()).toBe(false);
    } finally {
      restore();
    }

    expect(notes).toEqual([]);
    expect(rawSettings().telemetry).toBeUndefined();
  });
});

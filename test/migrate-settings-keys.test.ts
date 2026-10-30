import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkPendingMigrations, runMigrate } from "../src/cli/migrate";
import { freshTestDir } from "./lib/test-home";

let HOME: string;

const settingsFile = () => resolve(HOME, "memory", "pal-settings.json");

function writeSettings(value: unknown): void {
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(value));
}

const readSettings = () => JSON.parse(readFileSync(settingsFile(), "utf-8"));
const pendingIds = () => checkPendingMigrations().map((m) => m.id);

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
});

describe("v7-retired-settings-keys", () => {
  test("is pending while a key an older template wrote is still there", () => {
    writeSettings({ dynamicContext: { learningDigest: true } });

    expect(pendingIds()).toContain("v7-retired-settings-keys");
  });

  test("removes the retired keys and keeps every other setting", () => {
    writeSettings({
      identity: { ai: { name: "A" } },
      loadAtStartup: { _docs: "old", files: ["x.md"] },
      dynamicContext: {
        _docs: "old",
        learningDigest: true,
        projectHistory: true,
        sessionIntelligence: true,
        synthesis: true,
        signalTrends: true,
        activeWork: true,
        opinions: false,
        claimChek: true,
      },
      steering: { _docs: "old", disable: ["testing"] },
    });

    runMigrate([]);

    expect(readSettings()).toEqual({
      identity: { ai: { name: "A" } },
      loadAtStartup: { files: ["x.md"] },
      dynamicContext: { opinions: false, claimChek: true },
      steering: { disable: ["testing"] },
    });
    expect(pendingIds()).not.toContain("v7-retired-settings-keys");
  });

  test("removes the switches for the failures digest and prior lessons", () => {
    writeSettings({
      dynamicContext: { failurePatterns: true, learningInjection: false, opinions: true },
    });

    runMigrate([]);

    expect(readSettings()).toEqual({ dynamicContext: { opinions: true } });
  });

  test("removes the switches for wisdom, relationship notes and the self-model", () => {
    writeSettings({
      dynamicContext: {
        wisdom: true,
        relationship: false,
        selfModel: true,
        opinions: true,
      },
    });

    runMigrate([]);

    expect(readSettings()).toEqual({ dynamicContext: { opinions: true } });
  });

  test("removes the switches for the retired handoff and the always-on progress tree", () => {
    writeSettings({
      dynamicContext: { handoff: true, progressTree: false, opinions: true },
    });

    runMigrate([]);

    expect(readSettings()).toEqual({ dynamicContext: { opinions: true } });
  });

  test("a dry run leaves the file alone", () => {
    writeSettings({ dynamicContext: { learningDigest: true } });

    runMigrate(["--dry-run"]);

    expect(readSettings()).toEqual({ dynamicContext: { learningDigest: true } });
  });

  test("is not pending without a settings file", () => {
    expect(pendingIds()).not.toContain("v7-retired-settings-keys");
  });
});

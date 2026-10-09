import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { checkPendingMigrations, runMigrate } from "../src/cli/migrate";
import { removeOnceReleased } from "./lib/remove-once-released";

let HOME: string;
const savedHome = process.env.PAL_HOME;

const settingsFile = () => resolve(HOME, "memory", "pal-settings.json");

function writeSettings(value: unknown): void {
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(value));
}

const readSettings = () => JSON.parse(readFileSync(settingsFile(), "utf-8"));
const pendingIds = () => checkPendingMigrations().map((m) => m.id);

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-migrate-settings-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  removeOnceReleased(HOME);
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
        wisdom: false,
        claimChek: true,
      },
      steering: { _docs: "old", disable: ["testing"] },
    });

    runMigrate([]);

    expect(readSettings()).toEqual({
      identity: { ai: { name: "A" } },
      loadAtStartup: { files: ["x.md"] },
      dynamicContext: { wisdom: false, claimChek: true },
      steering: { disable: ["testing"] },
    });
    expect(pendingIds()).not.toContain("v7-retired-settings-keys");
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

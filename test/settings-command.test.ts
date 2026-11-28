import { beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { contentDir, eventsSince } from "../src/bronze/events";
import { setSetting, valueAt, withValueAt } from "../src/cli/settings-command";
import { raw, reload, settingsPath } from "../src/core/settings";
import { freshTestDir } from "./lib/test-home";

beforeEach(() => {
  process.env.PAL_HOME = freshTestDir(import.meta.file);
  writeFileSync(settingsPath(), JSON.stringify({ telemetry: { enabled: true } }));
  reload();
});

describe("pal cli settings set", () => {
  test("changes one dotted key and records the change in bronze", () => {
    expect(setSetting("telemetry.enabled", "false")).toEqual({
      previous: true,
      value: false,
    });
    expect(valueAt(raw(), "telemetry.enabled")).toBe(false);
    expect(eventsSince("setting", new Date(0))).toMatchObject([
      { key: "telemetry.enabled", change: "set" },
    ]);
    expect(contentDir()).toBeTruthy();
  });

  test("refuses a misspelled top-level key instead of writing it", () => {
    expect(() => setSetting("telemtry.enabled", "false")).toThrow(
      /unknown setting: telemtry/
    );
    expect(raw()).toEqual({ telemetry: { enabled: true } });
    expect(eventsSince("setting", new Date(0))).toEqual([]);
  });

  test("sets any key the schema declares, though the file does not have it yet", () => {
    setSetting("systemOne.provider", "typesafe");
    expect(valueAt(raw(), "systemOne.provider")).toBe("typesafe");
  });

  test.each([
    ["telemetry.enabled", "yes", "telemetry.enabled must be boolean"],
    ["controlRoom.quietAfterDays", "0", "controlRoom.quietAfterDays must be 1..365"],
    ["updateChannel", "nightly", 'updateChannel must be one of "stable", "canary"'],
  ])("refuses %s = %s: %s", (key, value, problem) => {
    expect(() => setSetting(key, value)).toThrow(problem);
    expect(raw()).toEqual({ telemetry: { enabled: true } });
  });

  test("a wrong value already in the file does not block changing another key", () => {
    writeFileSync(settingsPath(), JSON.stringify({ telemetry: { enabled: "yes" } }));
    reload();
    setSetting("updateChannel", "canary");
    expect(valueAt(raw(), "updateChannel")).toBe("canary");
  });

  test("a value that is not JSON is kept as text", () => {
    setSetting("updateChannel", "canary");
    expect(valueAt(raw(), "updateChannel")).toBe("canary");
  });
});

test("withValueAt leaves sibling keys alone", () => {
  expect(withValueAt({ a: { b: 1, c: 2 } }, "a.b", 3)).toEqual({ a: { b: 3, c: 2 } });
});

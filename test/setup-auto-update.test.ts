import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promptAutoUpdate } from "../src/cli/setup-auto-update";
import { raw as rawSettings, reload, write } from "../src/hooks/lib/settings";

// The install question must be silent wherever nobody can answer it. That is not
// politeness: the reinstall at the end of an unattended update runs without a
// terminal, and a prompt there would hang the update forever.

let HOME: string;
const prevHome = process.env.PAL_HOME;
const originalIsTTY = process.stdin.isTTY;

function setTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-setup-auto-update-"));
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  reload();
});

afterEach(() => {
  setTTY(originalIsTTY);
  if (prevHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = prevHome;
  rmSync(HOME, { recursive: true, force: true });
  reload();
});

describe("the install question", () => {
  test("asks nothing, and decides nothing, without a terminal", async () => {
    setTTY(undefined);

    await promptAutoUpdate();

    expect(existsSync(resolve(HOME, "memory", "pal-settings.json"))).toBe(false);
    expect(rawSettings().autoUpdate).toBeUndefined();
  });

  test("does not ask twice — an answered install is left alone", async () => {
    setTTY(true);
    write({ autoUpdate: { enabled: true, decided: true } });
    reload();

    await promptAutoUpdate();

    expect(rawSettings().autoUpdate).toEqual({ enabled: true, decided: true });
  });
});

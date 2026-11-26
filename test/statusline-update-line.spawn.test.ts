import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

// The statusline is where a user learns an update is waiting, so its advice has
// to match what PAL will actually do. With daily updates on, telling someone to
// run `pal cli update` is wrong: closing the session is what applies it.

const repo = resolve(import.meta.dir, "..");
const SESSION_JSON = JSON.stringify({
  model: { display_name: "Opus" },
  workspace: { current_dir: "/tmp" },
});

let HOME: string;

const FORMER_SETTINGS = ["memory", "pal-settings.json"];

function writeSettings(autoUpdate: boolean, at: string[]): void {
  writeFileSync(
    resolve(HOME, ".pal", ...at),
    JSON.stringify({ autoUpdate: { enabled: autoUpdate, decided: true } }),
    "utf-8"
  );
}

function writeCheck(latest: string, major: boolean): void {
  writeFileSync(
    resolve(HOME, ".pal", "cache", "update-available.json"),
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      available: true,
      current: "0.76.1",
      latest,
      mode: "repo",
      major,
    }),
    "utf-8"
  );
}

function fixture(autoUpdate: boolean, settingsAt: string[] = FORMER_SETTINGS): void {
  mkdirSync(resolve(HOME, ".pal", "cache"), { recursive: true });
  mkdirSync(resolve(HOME, ".pal", "memory"), { recursive: true });
  writeCheck("0.77.0", false);
  writeSettings(autoUpdate, settingsAt);
}

function render(): string {
  const run = spawnSync("bash", [resolve(repo, "assets", "statusline.sh")], {
    input: SESSION_JSON,
    encoding: "utf-8",
    env: { ...process.env, HOME },
  });

  return run.stdout ?? "";
}

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
});

describe.skipIf(process.platform === "win32")("the update line", () => {
  test("tells you to restart when PAL applies updates itself", () => {
    fixture(true);
    const line = render();
    expect(line).toContain("0.76.1 → 0.77.0");
    expect(line).toContain("restart to apply");
    expect(line).not.toContain("pal cli update");
  });

  test("tells you to run the command when it does not", () => {
    fixture(false);
    const line = render();
    expect(line).toContain("run: pal cli update");
    expect(line).not.toContain("restart to apply");
  });

  test("reads the settings at the PAL home's root once they have moved", () => {
    fixture(true, ["settings.json"]);
    expect(render()).toContain("restart to apply");
  });

  test("the moved settings win over a late copy left in memory/", () => {
    fixture(true, ["settings.json"]);
    writeSettings(false, FORMER_SETTINGS);
    expect(render()).toContain("restart to apply");
  });

  test("a new major asks for --major even when PAL applies updates itself", () => {
    fixture(true);
    writeCheck("1.0.0", true);
    const line = render();
    expect(line).toContain("new major: 0.76.1 → 1.0.0  run: pal cli update --major");
    expect(line).not.toContain("restart to apply");
  });

  test("says nothing at all when no update is waiting", () => {
    mkdirSync(resolve(HOME, ".pal", "memory", "state"), { recursive: true });
    expect(render()).not.toContain("update");
  });
});

// The PowerShell statusline has no bash to run it here, so its two branches are
// pinned at the source instead — the same check, one level less direct.
describe("the Windows statusline", () => {
  test("carries both branches of the same advice", () => {
    const ps1 = readFileSync(resolve(repo, "assets", "statusline.ps1"), "utf-8");
    expect(ps1).toContain("restart to apply");
    expect(ps1).toContain("run: pal cli update");
    expect(ps1).toContain("autoUpdate.enabled");
    expect(ps1).toContain("$uc.major -eq $true");
    expect(ps1).toContain("run: pal cli update --major");
  });
});

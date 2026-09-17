import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// The statusline is where a user learns an update is waiting, so its advice has
// to match what PAL will actually do. With daily updates on, telling someone to
// run `pal cli update` is wrong: closing the session is what applies it.

const repo = resolve(import.meta.dir, "..");
const SESSION_JSON = JSON.stringify({
  model: { display_name: "Opus" },
  workspace: { current_dir: "/tmp" },
});

let HOME: string;

function fixture(autoUpdate: boolean): void {
  mkdirSync(resolve(HOME, ".pal", "memory", "state"), { recursive: true });
  writeFileSync(
    resolve(HOME, ".pal", "memory", "state", "update-available.json"),
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      available: true,
      current: "0.76.1",
      latest: "0.77.0",
      mode: "repo",
    }),
    "utf-8"
  );
  writeFileSync(
    resolve(HOME, ".pal", "memory", "pal-settings.json"),
    JSON.stringify({ autoUpdate: { enabled: autoUpdate, decided: true } }),
    "utf-8"
  );
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
  HOME = mkdtempSync(resolve(tmpdir(), "pal-statusline-"));
});

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true });
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
  });
});

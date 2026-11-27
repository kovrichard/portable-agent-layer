import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { POWERSHELL_SPAWN_TEST_MS, SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

const isWindows = process.platform === "win32";
setDefaultTimeout(isWindows ? POWERSHELL_SPAWN_TEST_MS : SPAWN_HEAVY_TEST_MS);

const repo = resolve(import.meta.dir, "..");
const SESSION_JSON = JSON.stringify({
  model: { display_name: "Opus" },
  workspace: { current_dir: "/tmp" },
});

let HOME: string;

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
});

function syncStatus(status: Record<string, unknown>): void {
  mkdirSync(resolve(HOME, ".pal", "cache"), { recursive: true });
  writeFileSync(resolve(HOME, ".pal", "cache", "sync.json"), JSON.stringify(status));
}

function render(): string {
  const env = { ...process.env, HOME, USERPROFILE: HOME, DARK_FACTORY_HOME: "" };
  const run = isWindows
    ? spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve(repo, "assets", "statusline.ps1"),
        ],
        { input: SESSION_JSON, encoding: "utf-8", env }
      )
    : spawnSync("bash", [resolve(repo, "assets", "statusline.sh")], {
        input: SESSION_JSON,
        encoding: "utf-8",
        env,
      });

  return run.stdout ?? "";
}

const syncLines = () =>
  render()
    .split("\n")
    .filter((line) => line.includes("sync"));
const nowSec = () => Math.floor(Date.now() / 1000);

describe("the sync line", () => {
  test("a healthy, idle sync shows nothing", () => {
    syncStatus({ running: false, lastSuccessAt: new Date().toISOString(), notice: null });

    expect(syncLines()).toEqual([]);
  });

  test("no status file shows nothing", () => {
    expect(syncLines()).toEqual([]);
  });

  test("a run in progress shows that it is syncing", () => {
    syncStatus({ running: true, startedAt: nowSec() - 5, notice: null });

    expect(syncLines()).toHaveLength(1);
    expect(syncLines()[0]).toContain("syncing");
  });

  test("a run started over ten minutes ago died, so its notice shows instead", () => {
    syncStatus({
      running: true,
      startedAt: nowSec() - 601,
      notice: "2 refused (pal cli sync)",
    });

    expect(syncLines()).toHaveLength(1);
    expect(syncLines()[0]).toContain("sync: 2 refused (pal cli sync)");
  });

  test("a problem shows its notice until a run clears it", () => {
    syncStatus({
      running: false,
      notice: "1 file(s) in quarantine (pal cli sync status)",
    });

    expect(syncLines()[0]).toContain(
      "sync: 1 file(s) in quarantine (pal cli sync status)"
    );
  });
});

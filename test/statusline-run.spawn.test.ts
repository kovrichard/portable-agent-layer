import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  clearRun,
  newRun,
  type Run,
  type RunKind,
  untilLabel,
  writeRun,
} from "../src/safety/run-mode";
import { POWERSHELL_SPAWN_TEST_MS, SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

const isWindows = process.platform === "win32";
setDefaultTimeout(isWindows ? POWERSHELL_SPAWN_TEST_MS : SPAWN_HEAVY_TEST_MS);

const repo = resolve(import.meta.dir, "..");

let HOME: string;
let project: string;

function render(cwd: string): string {
  const input = JSON.stringify({
    model: { display_name: "Opus" },
    workspace: { current_dir: cwd },
  });
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
        { input, encoding: "utf-8", env }
      )
    : spawnSync("bash", [resolve(repo, "assets", "statusline.sh")], {
        input,
        encoding: "utf-8",
        env,
      });

  return run.stdout ?? "";
}

function runLines(cwd: string = project): string[] {
  return render(cwd)
    .split("\n")
    .filter((line) => /timebox|unattended|minimum run/.test(line));
}

function startRun(kind: RunKind, minutes: number, scope: string = project): Run {
  const run = newRun({
    kind,
    scope,
    until: new Date(Date.now() + minutes * 60_000),
  });
  writeRun(run);

  return run;
}

function writePalFile(path: string, content: unknown): void {
  const file = resolve(HOME, ".pal", path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(content));
}

function hourMinuteIn(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = resolve(HOME, ".pal");
  project = resolve(HOME, "work", "app");
  mkdirSync(resolve(project, "src"), { recursive: true });
});

describe("the run line", () => {
  test("shows nothing when no run is on", () => {
    expect(runLines()).toEqual([]);
  });

  test("shows a timebox's deadline and the minutes left", () => {
    const run = startRun("timebox", 25);
    const lines = runLines();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("timebox");
    expect(lines[0]).toContain(`until ${untilLabel(run)}`);
    expect(lines[0]).toContain("25m left");
  });

  test("shows an unattended run's deadline in hours and minutes", () => {
    const run = startRun("unattended", 150);
    const [line] = runLines();

    expect(line).toContain("unattended");
    expect(line).toContain(`until ${untilLabel(run)}`);
    expect(line).toContain("2h30m left");
  });

  test("shows a minimum run's floor and the rounds logged", () => {
    const run = startRun("minimum", 30);
    writeRun({
      ...run,
      rounds: [
        { at: new Date().toISOString(), scores: "a: 5/10", weakest: "a", did: "b" },
      ],
    });
    const [line] = runLines();

    expect(line).toContain(`minimum run`);
    expect(line).toContain(`floor ${untilLabel(run)}`);
    expect(line).toContain("1 round");
    expect(line).not.toContain("1 rounds");
  });

  test("disappears once the run is ended", () => {
    const run = startRun("timebox", 25);
    clearRun(run.scope);

    expect(runLines()).toEqual([]);
  });

  test("disappears once an unattended run is marked done", () => {
    const run = startRun("unattended", 60);
    writeRun({ ...run, done: true });

    expect(runLines()).toEqual([]);
  });

  test("disappears once the deadline has passed", () => {
    startRun("timebox", -5);

    expect(runLines()).toEqual([]);
  });

  test("leaves out a run of another folder", () => {
    startRun("timebox", 25, resolve(HOME, "work", "other"));

    expect(runLines()).toEqual([]);
  });

  test("shows a project's run in the project's subfolders", () => {
    writePalFile("bindings.json", { app: project });
    startRun("timebox", 25, "app");

    expect(runLines(resolve(project, "src"))).toHaveLength(1);
  });

  test.skipIf(isWindows)("tells the deadline in the user's timezone", () => {
    const zone = "Asia/Kathmandu";
    writePalFile("memory/pal-settings.json", {
      identity: { principal: { timezone: zone } },
    });
    const run = startRun("timebox", 25);

    expect(runLines()[0]).toContain(`until ${hourMinuteIn(zone, new Date(run.until))}`);
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  autoUpdateOnClose,
  autoUpdateOnStart,
  autoUpdateStatus,
  endsTheSession,
  readLedger,
  runAutoUpdate,
  shouldAutoUpdate,
} from "../src/hooks/lib/auto-update";
import { paths } from "../src/hooks/lib/paths";
import { reload } from "../src/hooks/lib/settings";

// The gate is the whole feature: everything downstream of it is `pal cli update`,
// which has its own tests. So each state that must NOT start an update is built
// deliberately here — an opted-out install, one that already tried today, and a
// clone with uncommitted work — rather than asserting only the happy path.

let HOME: string;
let PKG: string;
const prevHome = process.env.PAL_HOME;
const prevPkg = process.env.PAL_PKG;

const HOUR_MS = 60 * 60 * 1000;

function git(...args: string[]): void {
  spawnSync("git", args, { cwd: PKG, stdio: "ignore" });
}

/** A clean clone with one commit — the shape isRepoMode() and the dirty check read. */
function repoFixture(version = "0.76.1"): void {
  git("init", "-b", "main");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  writeFileSync(resolve(PKG, "package.json"), JSON.stringify({ version }), "utf-8");
  git("add", "-A");
  git("commit", "-m", "base");
}

function setSettings(autoUpdate: Record<string, boolean>): void {
  writeFileSync(
    resolve(HOME, "memory", "pal-settings.json"),
    JSON.stringify({ autoUpdate }),
    "utf-8"
  );
  reload();
}

function setLedger(entry: Record<string, unknown>): void {
  writeFileSync(
    resolve(paths.state(), "auto-update.json"),
    JSON.stringify(entry),
    "utf-8"
  );
}

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-auto-update-home-"));
  PKG = mkdtempSync(resolve(tmpdir(), "pal-auto-update-pkg-"));
  process.env.PAL_HOME = HOME;
  process.env.PAL_PKG = PKG;
  mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
  repoFixture();
  reload();
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = prevHome;
  if (prevPkg === undefined) delete process.env.PAL_PKG;
  else process.env.PAL_PKG = prevPkg;
  for (const dir of [HOME, PKG]) rmSync(dir, { recursive: true, force: true });
  reload();
});

describe("the daily gate", () => {
  test("a fresh install never updates itself", () => {
    expect(shouldAutoUpdate()).toBe(false);
  });

  test("an install that opted out never updates itself", () => {
    setSettings({ enabled: false, decided: true });
    expect(shouldAutoUpdate()).toBe(false);
  });

  test("opted in, nothing tried yet, clean clone — it runs", () => {
    setSettings({ enabled: true, decided: true });
    expect(shouldAutoUpdate()).toBe(true);
  });

  test("an attempt an hour ago holds it until tomorrow", () => {
    setSettings({ enabled: true, decided: true });
    setLedger({ attemptedAt: ago(HOUR_MS) });
    expect(shouldAutoUpdate()).toBe(false);
  });

  test("an attempt 25 hours ago lets the next one through", () => {
    setSettings({ enabled: true, decided: true });
    setLedger({ attemptedAt: ago(25 * HOUR_MS) });
    expect(shouldAutoUpdate()).toBe(true);
  });

  test("a failed attempt still holds the day, so a broken update cannot loop", () => {
    setSettings({ enabled: true, decided: true });
    setLedger({ attemptedAt: ago(HOUR_MS), finishedAt: ago(HOUR_MS), ok: false });
    expect(shouldAutoUpdate()).toBe(false);
  });
});

describe("uncommitted work", () => {
  test("a dirty clone waits, and says why", () => {
    setSettings({ enabled: true, decided: true });
    writeFileSync(resolve(PKG, "work.txt"), "unstaged change", "utf-8");

    expect(shouldAutoUpdate()).toBe(false);
    expect(readLedger()?.skipped).toContain("uncommitted changes");
  });

  test("waiting does not consume the day — the next session tries again", () => {
    setSettings({ enabled: true, decided: true });
    const dirt = resolve(PKG, "work.txt");
    writeFileSync(dirt, "unstaged change", "utf-8");
    expect(shouldAutoUpdate()).toBe(false);
    expect(readLedger()?.attemptedAt).toBeUndefined();

    rmSync(dirt);
    expect(shouldAutoUpdate()).toBe(true);
  });

  test("a package install has no clone, so nothing holds it back", () => {
    setSettings({ enabled: true, decided: true });
    rmSync(resolve(PKG, ".git"), { recursive: true, force: true });
    writeFileSync(resolve(PKG, "work.txt"), "loose file beside the package", "utf-8");

    expect(autoUpdateStatus().mode).toBe("package");
    expect(shouldAutoUpdate()).toBe(true);
    expect(readLedger()).toBeNull();
  });

  test("the button cannot pull over uncommitted work either", () => {
    writeFileSync(resolve(PKG, "work.txt"), "unstaged change", "utf-8");

    runAutoUpdate();

    expect(readLedger()?.skipped).toContain("uncommitted changes");
    expect(readLedger()?.attemptedAt).toBeUndefined();
  });
});

// The clone has no src/cli/index.ts, so the spawned update exits nonzero — which
// is the case worth pinning: the attempt must already be on record by then.
describe("a run that fails", () => {
  test("is recorded, and holds the day", () => {
    setSettings({ enabled: true, decided: true });

    const ledger = runAutoUpdate();

    expect(ledger.attemptedAt).toBeTruthy();
    expect(ledger.ok).toBe(false);
    expect(ledger.error).toBeTruthy();
    expect(shouldAutoUpdate()).toBe(false);
  });
});

/** Stands in for `pal cli update`, and leaves a mark when it actually ran. */
function countingUpdateCommand(marker: string): void {
  mkdirSync(resolve(PKG, "src", "cli"), { recursive: true });
  writeFileSync(
    resolve(PKG, "src", "cli", "index.ts"),
    `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(marker)}, "ran\\n");`,
    "utf-8"
  );
  git("add", "-A");
  git("commit", "-m", "counting update command");
}

/** Stands in for `pal cli update`, and copies the ledger as it found it. */
function fakeUpdateCommand(): string {
  const seen = resolve(PKG, "seen.json");
  mkdirSync(resolve(PKG, "src", "cli"), { recursive: true });
  writeFileSync(
    resolve(PKG, "src", "cli", "index.ts"),
    [
      'import { copyFileSync } from "node:fs";',
      'import { resolve } from "node:path";',
      `copyFileSync(resolve(String(process.env.PAL_HOME), "memory", "state", "auto-update.json"), ${JSON.stringify(seen)});`,
    ].join("\n"),
    "utf-8"
  );
  git("add", "-A");
  git("commit", "-m", "fake update command");
  return seen;
}

describe("the attempt stamp", () => {
  test("is on disk before the update command runs, not after it returns", () => {
    setSettings({ enabled: true, decided: true });
    const seen = fakeUpdateCommand();

    runAutoUpdate();

    const asTheChildSawIt = JSON.parse(readFileSync(seen, "utf-8")) as {
      attemptedAt?: string;
    };
    expect(asTheChildSawIt.attemptedAt).toBeTruthy();
  });
});

// Claude's SessionEnd fires for /clear and for resume, where the CLI keeps
// running; Copilot does the same on /clear. Updating there would rewrite the
// config of a session the user is still sitting in.
describe("which kind of close starts an update", () => {
  test("quitting does", () => {
    for (const reason of ["prompt_input_exit", "logout", "other", undefined]) {
      expect(endsTheSession(reason)).toBe(true);
    }
  });

  test("clearing or resuming does not", () => {
    expect(endsTheSession("clear")).toBe(false);
    expect(endsTheSession("resume")).toBe(false);
  });

  test("a clear never starts an update, however overdue one is", () => {
    setSettings({ enabled: true, decided: true });
    expect(shouldAutoUpdate()).toBe(true);

    expect(autoUpdateOnClose("clear")).toBeNull();
    expect(readLedger()).toBeNull();
  });

  test("an opted-out install starts nothing on close", () => {
    expect(autoUpdateOnClose("logout")).toBeNull();
  });
});

// A terminal that starts a minutes-long reinstall and says nothing reads as a
// hang, and a hang gets CTRL+C. It does not actually wait — the child is
// detached — so the line says there is nothing to wait for.
describe("what the closing terminal says", () => {
  test("names the versions it is moving between", () => {
    setSettings({ enabled: true, decided: true });
    writeFileSync(
      resolve(paths.state(), "update-available.json"),
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        available: true,
        current: "0.76.1",
        latest: "0.77.0",
        mode: "repo",
      }),
      "utf-8"
    );

    const notice = autoUpdateOnClose("prompt_input_exit");

    expect(notice).toContain("0.76.1 → 0.77.0");
    expect(notice).toContain("nothing to wait for");
  });

  test("explains a clone it could not touch, instead of going quiet", () => {
    setSettings({ enabled: true, decided: true });
    writeFileSync(resolve(PKG, "work.txt"), "unstaged change", "utf-8");

    expect(autoUpdateOnClose("prompt_input_exit")).toContain("uncommitted changes");
  });

  test("says nothing when yesterday's skip is the only thing on file", () => {
    setSettings({ enabled: true, decided: true });
    setLedger({
      attemptedAt: ago(HOUR_MS),
      skippedAt: ago(30 * HOUR_MS),
      skipped: "uncommitted changes",
    });

    expect(autoUpdateOnClose("prompt_input_exit")).toBeNull();
  });

  test("says nothing at all when updates are off", () => {
    expect(autoUpdateOnClose("prompt_input_exit")).toBeNull();
  });
});

// Without this, a session that is killed — or an agent whose close event never
// arrives — leaves the install pinned on a statusline telling it to restart,
// which would do nothing. Start is the rescue, not the schedule.
describe("when the close hook never fires", () => {
  test("an install that has never managed an attempt is rescued at start", () => {
    setSettings({ enabled: true, decided: true });
    expect(autoUpdateOnStart()).toBe(true);
  });

  test("a close that ran yesterday means start stays out of the way", () => {
    setSettings({ enabled: true, decided: true });
    setLedger({ attemptedAt: ago(25 * HOUR_MS), ok: true });
    expect(autoUpdateOnStart()).toBe(false);
  });

  test("four days of silence brings the rescue back", () => {
    setSettings({ enabled: true, decided: true });
    setLedger({ attemptedAt: ago(4 * 24 * HOUR_MS), ok: true });
    expect(autoUpdateOnStart()).toBe(true);
  });

  test("an opted-out install is never rescued", () => {
    expect(autoUpdateOnStart()).toBe(false);
  });
});

describe("two sessions closing at once", () => {
  test("the second one finds the lock held and leaves the clone alone", () => {
    setSettings({ enabled: true, decided: true });
    const seen = resolve(PKG, "runs.txt");
    countingUpdateCommand(seen);

    writeFileSync(
      resolve(paths.state(), "auto-update.lock"),
      JSON.stringify({ pid: 1, at: new Date().toISOString() }),
      "utf-8"
    );
    runAutoUpdate();

    expect(existsSync(seen)).toBe(false);
  });

  test("a lock left behind by a dead run is taken over", () => {
    setSettings({ enabled: true, decided: true });
    const seen = resolve(PKG, "runs.txt");
    countingUpdateCommand(seen);

    writeFileSync(
      resolve(paths.state(), "auto-update.lock"),
      JSON.stringify({ pid: 1, at: ago(31 * 60 * 1000) }),
      "utf-8"
    );
    runAutoUpdate();

    expect(existsSync(seen)).toBe(true);
  });

  test("the lock is released, so tomorrow's run is not blocked by today's", () => {
    setSettings({ enabled: true, decided: true });
    runAutoUpdate();
    expect(existsSync(resolve(paths.state(), "auto-update.lock"))).toBe(false);
  });
});

describe("what the page reads", () => {
  test("reports the toggle, the installed version and the last run", () => {
    setSettings({ enabled: true, decided: true });
    setLedger({ finishedAt: ago(HOUR_MS), ok: true, from: "0.76.0", to: "0.76.1" });

    const status = autoUpdateStatus();

    expect(status.enabled).toBe(true);
    expect(status.decided).toBe(true);
    expect(status.current).toBe("0.76.1");
    expect(status.mode).toBe("repo");
    expect(status.last?.to).toBe("0.76.1");
  });

  test("an install that has never checked reports no candidate version", () => {
    const status = autoUpdateStatus();

    expect(status.enabled).toBe(false);
    expect(status.available).toBe(false);
    expect(status.latest).toBeNull();
    expect(status.last).toBeNull();
  });
});

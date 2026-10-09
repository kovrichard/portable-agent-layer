import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runSync } from "./lib/run";
import { freshTestDir } from "./lib/test-home";

let ROOT: string;

beforeEach(() => {
  ROOT = realpathSync(freshTestDir(import.meta.file));
  process.env.PAL_HOME = resolve(ROOT, "pal");
  mkdirSync(resolve(ROOT, "pal", "memory"), { recursive: true });
});

async function setSettings(data: Record<string, unknown>) {
  writeFileSync(
    resolve(ROOT, "pal", "memory", "pal-settings.json"),
    JSON.stringify(data)
  );
  (await import("../src/hooks/lib/settings")).reload();
}

async function repoStateReminder(cwd: string) {
  const { getRepoStateReminder } = await import("../src/hooks/lib/repo-state");
  return getRepoStateReminder(cwd);
}

function git(dir: string, ...args: string[]): void {
  const result = runSync(
    [
      "git",
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd: dir }
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

function commit(dir: string, file: string): void {
  writeFileSync(resolve(dir, file), file);
  git(dir, "add", file);
  git(dir, "commit", "-qm", file);
}

/** A checkout of a remote, both on disk, with one released commit on main. */
function released(name = "app"): string {
  const remote = resolve(ROOT, `${name}.git`);
  const dir = resolve(ROOT, name);
  mkdirSync(remote);
  git(remote, "init", "-q", "--bare");
  mkdirSync(dir);
  git(dir, "init", "-q");
  commit(dir, "a");
  git(dir, "tag", "v1.0.0");
  git(dir, "remote", "add", "origin", remote);
  git(dir, "push", "-q", "-u", "origin", "main", "--tags");
  return dir;
}

async function registerProject(name: string, path: string) {
  const { writeProject } = await import("../src/hooks/lib/projects");
  const now = new Date().toISOString();
  writeProject({ name, path, status: "active", created: now, updated: now });
}

describe("a git checkout", () => {
  test("in sync with its remote says so, with the release it sits on", async () => {
    const dir = released();

    expect(await repoStateReminder(dir)).toBe(
      "<system-reminder>Repo: app on main · clean · pushed · at tag v1.0.0</system-reminder>"
    );
  });

  test("counts the files not committed and the commits not pushed", async () => {
    const dir = released();
    commit(dir, "b");
    commit(dir, "c");
    writeFileSync(resolve(dir, "d"), "d");
    writeFileSync(resolve(dir, "a"), "changed");

    const line = await repoStateReminder(dir);
    expect(line).toContain("2 files uncommitted");
    expect(line).toContain("2 commits not pushed");
    expect(line).toContain("2 commits since tag v1.0.0");
  });

  test("names commits the remote has that are not pulled yet", async () => {
    const dir = released();
    commit(dir, "b");
    git(dir, "push", "-q");
    git(dir, "reset", "-q", "--hard", "HEAD~1");

    expect(await repoStateReminder(dir)).toContain("1 commit behind origin/main");
  });

  test("a branch never pushed says it has no upstream", async () => {
    const dir = released();
    git(dir, "checkout", "-qb", "fix/thing");

    expect(await repoStateReminder(dir)).toContain(
      "app on fix/thing · clean · never pushed"
    );
  });

  test("a subdirectory reports the checkout it belongs to", async () => {
    const dir = released();
    mkdirSync(resolve(dir, "src"));

    expect(await repoStateReminder(resolve(dir, "src"))).toContain("Repo: app on main");
  });

  test("an empty repository without tags still gets a line", async () => {
    const dir = resolve(ROOT, "fresh");
    mkdirSync(dir);
    git(dir, "init", "-q");

    expect(await repoStateReminder(dir)).toBe(
      "<system-reminder>Repo: fresh on main · no commits yet · never pushed</system-reminder>"
    );
  });
});

describe("a project without git", () => {
  test("says nothing there is committed, pushed or released", async () => {
    const dir = resolve(ROOT, "notes");
    mkdirSync(dir);
    await registerProject("notes", dir);

    expect(await repoStateReminder(dir)).toBe(
      "<system-reminder>Repo: notes is not under git — nothing in it is committed, pushed or released; the files on disk are its whole state</system-reminder>"
    );
  });

  test("an unregistered directory without git gets no line", async () => {
    const dir = resolve(ROOT, "scratch");
    mkdirSync(dir);

    expect(await repoStateReminder(dir)).toBeNull();
  });
});

test("the line is off when repoState is disabled", async () => {
  await setSettings({ dynamicContext: { repoState: false } });

  expect(await repoStateReminder(released())).toBeNull();
});

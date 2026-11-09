import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeRoleSettings } from "../assets/plugins/dark-factory/scripts/settings.mjs";
import { freshTestDir } from "./lib/test-home";

const ATTRIBUTION = { commit: "Co-authored by Jarvis", pr: "Co-authored by [Jarvis]" };
const PERMISSIONS = {
  allow: ["Bash(bun test:*)"],
  deny: ["Bash(sed -i:*)"],
  ask: ["Bash(git push:*)"],
};

let root: string;
let env: Record<string, string>;

function writeJson(file: string, value: unknown) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

function repoWith(settings: unknown) {
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  if (settings !== undefined) writeJson(join(repo, ".claude/settings.json"), settings);
  return { id: "t1", repo, worktree: repo };
}

function writtenFor(task: object) {
  const file = writeRoleSettings(task, env);
  return file === null ? null : JSON.parse(readFileSync(file, "utf8"));
}

beforeEach(() => {
  root = freshTestDir("dark-factory-settings-repo");
  env = { HOME: join(root, "home"), DARK_FACTORY_HOME: join(root, "factory") };
});

describe("writeRoleSettings with the repo's permissions", () => {
  test("the repo's allow, deny and ask lists land after the user's filtered settings, never its hooks", () => {
    writeJson(join(env.HOME, ".claude/settings.json"), {
      attribution: ATTRIBUTION,
      hooks: { Stop: [] },
      permissions: { allow: ["Bash(user *)"] },
    });
    const task = repoWith({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "run-the-repo-gate" }] }] },
      permissions: PERMISSIONS,
    });
    const written = writtenFor(task);
    expect(written).toEqual({ attribution: ATTRIBUTION, permissions: PERMISSIONS });
    expect(JSON.stringify(written)).not.toContain("run-the-repo-gate");
  });

  test("a repo with permissions and no user settings still gives a file with only them", () => {
    const written = writtenFor(
      repoWith({ hooks: { Stop: [] }, permissions: PERMISSIONS })
    );
    expect(written).toEqual({ permissions: PERMISSIONS });
  });

  test("a repo without .claude/settings.json gives the same file as today", () => {
    writeJson(join(env.HOME, ".claude/settings.json"), { attribution: ATTRIBUTION });
    expect(writtenFor(repoWith(undefined))).toEqual({ attribution: ATTRIBUTION });
  });

  test("a repo whose settings have hooks but no permissions gives the same file as today", () => {
    writeJson(join(env.HOME, ".claude/settings.json"), { attribution: ATTRIBUTION });
    expect(writtenFor(repoWith({ hooks: { Stop: [] } }))).toEqual({
      attribution: ATTRIBUTION,
    });
  });

  test("nothing from the user and nothing from the repo writes no file", () => {
    expect(writeRoleSettings(repoWith({ hooks: { Stop: [] } }), env)).toBeNull();
    expect(writeRoleSettings(repoWith(undefined), env)).toBeNull();
  });

  test("unreadable repo settings count as absent", () => {
    const task = repoWith(undefined);
    mkdirSync(join(task.repo, ".claude"), { recursive: true });
    writeFileSync(join(task.repo, ".claude/settings.json"), "{ not json");
    writeJson(join(env.HOME, ".claude/settings.json"), { attribution: ATTRIBUTION });
    expect(writtenFor(task)).toEqual({ attribution: ATTRIBUTION });
  });

  test("running it twice writes the same file", () => {
    const task = repoWith({ permissions: PERMISSIONS });
    const first = writtenFor(task);
    expect(first).toEqual({ permissions: PERMISSIONS });
    expect(writtenFor(task)).toEqual(first);
  });
});

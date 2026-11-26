import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { POWERSHELL_SPAWN_TEST_MS, SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

const isWindows = process.platform === "win32";
setDefaultTimeout(isWindows ? POWERSHELL_SPAWN_TEST_MS : SPAWN_HEAVY_TEST_MS);

const repo = resolve(import.meta.dir, "..");

let HOME: string;

function project(slug: string, open: number, done: number): void {
  const dir = resolve(HOME, ".pal", "work", "projects", slug);
  mkdirSync(dir, { recursive: true });
  const criteria = [
    ...Array.from(
      { length: open },
      (_, i) => `- [ ] ISC-${i + 1}: open, mentions path: /elsewhere`
    ),
    ...Array.from({ length: done }, (_, i) => `- [x] ISC-${open + i + 1}: done`),
  ];
  writeFileSync(
    resolve(dir, "ISA.md"),
    `# ${slug}\n\n## Criteria\n\n${criteria.join("\n")}\n`
  );
}

function bind(bindings: Record<string, string>): void {
  mkdirSync(resolve(HOME, ".pal"), { recursive: true });
  writeFileSync(resolve(HOME, ".pal", "bindings.json"), JSON.stringify(bindings));
}

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

  return (run.stdout ?? "").split("\n")[0];
}

const repoDir = (name: string) => resolve(HOME, "git", name);

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  project("shop", 3, 2);
  project("shop-admin", 5, 0);
  bind({ shop: repoDir("shop"), "shop-admin": repoDir("shop/admin") });
});

describe("the status line's open-ISC count", () => {
  test("counts the open criteria of the project bound to the cwd", () => {
    expect(render(repoDir("shop"))).toContain("3 open ISCs");
  });

  test("counts them from a folder inside the project", () => {
    expect(render(resolve(repoDir("shop"), "src"))).toContain("3 open ISCs");
  });

  test("picks the most specific project when one is bound inside another", () => {
    expect(render(resolve(repoDir("shop"), "admin", "lib"))).toContain("5 open ISCs");
  });

  test("shows no count outside every bound project", () => {
    expect(render(repoDir("shopping"))).not.toContain("open ISCs");
  });
});

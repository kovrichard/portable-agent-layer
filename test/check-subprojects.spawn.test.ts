import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { outsideRepoHome } from "./lib/test-home";

const SCRIPT = resolve(import.meta.dir, "../.agents/scripts/check-subprojects.ts");

function run(cwd: string, command: string, args: string[]): void {
  const r = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${command} ${args.join(" ")}: ${r.stderr}`);
}

function writeProjectWithTypeError(dir: string): void {
  mkdirSync(join(dir, "helper"), { recursive: true });
  writeFileSync(join(dir, "helper", "package.json"), JSON.stringify({ name: "helper" }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "app", dependencies: { helper: "file:./helper" } })
  );
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["*.ts"] })
  );
  writeFileSync(join(dir, "index.ts"), 'export const count: number = "three";\n');
}

function repoWithBrokenSubproject(): string {
  const root = outsideRepoHome(import.meta.path);
  const project = join(root, "nested", "app");
  writeProjectWithTypeError(project);
  run(project, process.execPath, ["install", "--ignore-scripts"]);
  run(root, "git", ["init", "-q"]);
  run(root, "git", ["add", "-A"]);

  return root;
}

describe("check-subprojects", () => {
  test("fails at tsc and names the subproject that holds the type error", () => {
    const root = repoWithBrokenSubproject();
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: "utf8" });
    expect(r.stderr).toContain("index.ts");
    expect(r.stderr).toContain("subprojects: nested/app failed at tsc");
    expect(r.status).toBe(1);
  });
});

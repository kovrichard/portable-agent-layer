import { beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { assets } from "../src/hooks/lib/paths";
import { lintSubagent } from "../src/tools/subagent-doctor";
import { linkDir } from "./lib/links";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const ROOT = testHome(import.meta.file);
// Undo the previous test's state first; cleanup after the run is the framework's job.
beforeEach(() => removeOnceReleased(ROOT));

const SHIPPED_DIR = assets.agents();
const SCOUT = resolve(SHIPPED_DIR, "scout.md");

const collision = (file: string) =>
  lintSubagent(file).findings.find((f) => f.check === "name.collision");

function copyTo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const target = resolve(dir, "scout.md");
  copyFileSync(SCOUT, target);
  return target;
}

describe("subagent doctor on shipped definitions", () => {
  test("a shipped file passes name.collision with the shipped message", () => {
    const f = collision(SCOUT);
    expect(f?.level).toBe("pass");
    expect(f?.message).toContain("is a shipped PAL subagent");
    expect(
      lintSubagent(SCOUT).findings.some(
        (x) => x.check === "name.collision" && x.level === "error"
      )
    ).toBe(false);
  });

  test("a copy of a shipped definition outside the shipped folder errors", () => {
    const f = collision(copyTo(resolve(ROOT, "copy")));
    expect(f?.level).toBe("error");
  });

  test("shipped file through a relative path counts as shipped", () => {
    const rel = relative(process.cwd(), SCOUT);
    expect(collision(rel)?.level).toBe("pass");
  });

  test("shipped file through a .. segment counts as shipped", () => {
    const viaDots = resolve(SHIPPED_DIR, "..", "agents", "scout.md");
    const odd = `${SHIPPED_DIR}/../agents/scout.md`;
    expect(collision(viaDots)?.level).toBe("pass");
    expect(collision(odd)?.level).toBe("pass");
  });

  test("a symbolic link into the shipped folder counts as shipped", () => {
    const link = resolve(ROOT, "linked");
    mkdirSync(ROOT, { recursive: true });
    linkDir(SHIPPED_DIR, link);
    expect(collision(resolve(link, "scout.md"))?.level).toBe("pass");
  });

  test("an unrelated folder named agents does not count as shipped", () => {
    const f = collision(copyTo(resolve(ROOT, "elsewhere", "agents")));
    expect(f?.level).toBe("error");
  });

  test("linting a shipped file twice gives the same report", () => {
    expect(lintSubagent(SCOUT)).toEqual(lintSubagent(SCOUT));
  });

  test("every shipped definition reports 0 errors", () => {
    const files = readdirSync(SHIPPED_DIR).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const report = lintSubagent(resolve(SHIPPED_DIR, file));
      const errs = report.findings.filter((f) => f.level === "error");
      expect({ file, errors: report.errors, findings: errs.map((e) => e.check) }).toEqual(
        { file, errors: 0, findings: [] }
      );
    }
  });

  test("README row for subagent doctor names the collision check and the shipped case", () => {
    const readme = readFileSync(resolve(import.meta.dir, "../README.md"), "utf-8");
    const row = readme.split("\n").find((l) => l.includes("pal cli subagent doctor"));
    expect(row).toBeDefined();
    expect(row).toMatch(/collision/i);
    expect(row).toMatch(/shipped definition/i);
    expect(row).toMatch(/path/i);
  });
});

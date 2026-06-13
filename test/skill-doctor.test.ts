import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { lintSkill } from "../src/tools/skill-doctor";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const ROOT = resolve(import.meta.dir, "../.test-home-skill-doctor");

let counter = 0;
/**
 * Write a skill fixture and return its directory. The folder is named after the
 * skill's frontmatter `name` so the name/folder check passes by default; tests
 * that target other checks stay isolated.
 */
function fixture(skillMd: string, extra: Record<string, string> = {}): string {
  counter += 1;
  const name = /^name:\s*(.+)$/m.exec(skillMd)?.[1]?.trim() ?? "skill";
  const dir = resolve(ROOT, `case-${counter}`, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "SKILL.md"), skillMd);
  for (const [file, content] of Object.entries(extra)) {
    writeFileSync(resolve(dir, file), content);
  }
  return dir;
}

const GOOD = `---
name: good-skill
description: "Summarizes a thing into a report. Use when the user asks to summarize a thing."
---

# Good skill

1. Read the input.
2. Produce the output.
`;

function levelOf(dir: string, check: string) {
  return lintSkill(dir).findings.find((f) => f.check === check)?.level;
}

beforeAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
});

describe("lintSkill", () => {
  test("a well-formed skill has zero errors", () => {
    const r = lintSkill(fixture(GOOD));
    expect(r.errors).toBe(0);
  });

  test("missing SKILL.md is a structural error", () => {
    const dir = resolve(ROOT, "empty");
    mkdirSync(dir, { recursive: true });
    const r = lintSkill(dir);
    expect(r.errors).toBe(1);
    expect(r.findings[0].check).toBe("structure");
  });

  test("uppercase name fails the charset rule", () => {
    const dir = fixture(GOOD.replace("good-skill", "BadName"));
    expect(levelOf(dir, "name.charset")).toBe("error");
  });

  test("name over 64 chars fails the length rule", () => {
    const long = "a".repeat(70);
    const dir = fixture(GOOD.replace("good-skill", long));
    expect(levelOf(dir, "name.length")).toBe("error");
  });

  test("reserved word in name is an error", () => {
    const dir = fixture(GOOD.replace("good-skill", "claude-helper"));
    expect(levelOf(dir, "name.reserved")).toBe("error");
  });

  test("description over 1024 chars fails", () => {
    const huge = `Does a thing. Use when needed. ${"x".repeat(1100)}`;
    const dir = fixture(GOOD.replace(/description: .*/, `description: ${huge}`));
    expect(levelOf(dir, "description.length")).toBe("error");
  });

  test("description without a 'when' trigger warns", () => {
    const dir = fixture(
      GOOD.replace(/description: .*/, "description: Summarizes things.")
    );
    expect(levelOf(dir, "description.trigger")).toBe("warn");
  });

  test("first-person description warns on point-of-view", () => {
    const dir = fixture(
      GOOD.replace(
        /description: .*/,
        "description: I can help you when you need a summary."
      )
    );
    expect(levelOf(dir, "description.pov")).toBe("warn");
  });

  test("angle brackets in description warn (not error)", () => {
    const dir = fixture(
      GOOD.replace(
        /description: .*/,
        "description: Stores under <project>. Use when tracking."
      )
    );
    expect(levelOf(dir, "description.xml")).toBe("warn");
    expect(lintSkill(dir).errors).toBe(0);
  });

  test("unquoted description warns on quoting", () => {
    const dir = fixture(
      GOOD.replace(
        /description: .*/,
        "description: Summarizes a thing. Use when summarizing."
      )
    );
    expect(levelOf(dir, "description.quoted")).toBe("warn");
    expect(lintSkill(dir).errors).toBe(0);
  });

  test("double-quoted description passes the quoting check", () => {
    expect(levelOf(fixture(GOOD), "description.quoted")).toBe("pass");
  });

  test("body over 500 lines warns", () => {
    const big = `${GOOD}\n${"line\n".repeat(520)}`;
    const dir = fixture(big);
    expect(levelOf(dir, "body.length")).toBe("warn");
  });

  test("nested references warn", () => {
    const skill = `${GOOD}\nSee [advanced](advanced.md).\n`;
    const dir = fixture(skill, { "advanced.md": "More: see [details](details.md).\n" });
    expect(levelOf(dir, "references.depth")).toBe("warn");
  });

  test("one-level reference passes", () => {
    const skill = `${GOOD}\nSee [advanced](advanced.md).\n`;
    const dir = fixture(skill, { "advanced.md": "Just text, no further links.\n" });
    expect(levelOf(dir, "references.depth")).toBe("pass");
  });

  test("a reference that only links back to SKILL.md is not nested", () => {
    const skill = `${GOOD}\nSee [advanced](advanced.md).\n`;
    const dir = fixture(skill, {
      "advanced.md": "Read [SKILL.md](SKILL.md) first, then follow these steps.\n",
    });
    expect(levelOf(dir, "references.depth")).toBe("pass");
  });

  test("windows-style path in body warns", () => {
    const dir = fixture(`${GOOD}\nRun scripts\\helper.py to start.\n`);
    expect(levelOf(dir, "paths")).toBe("warn");
  });

  test("intentional Windows cmd.exe example does not warn on paths", () => {
    const dir = fixture(
      `${GOOD}\n# Windows cmd.exe:\nbun %USERPROFILE%\\.pal\\skills\\x\\tools\\build.ts deck\n`
    );
    expect(levelOf(dir, "paths")).toBe("pass");
  });

  test("name not matching the folder is an error", () => {
    const dir = resolve(ROOT, "folder-mismatch", "wrong-folder");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "SKILL.md"), GOOD); // name: good-skill ≠ wrong-folder
    expect(levelOf(dir, "name.folder")).toBe("error");
  });

  test("a file not named exactly SKILL.md is an error", () => {
    const dir = resolve(ROOT, "case-file", "good-skill");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "skill.md"), GOOD); // lowercase — silently ignored at runtime
    expect(levelOf(dir, "file.name")).toBe("error");
  });
});

describe("pal cli skill doctor", () => {
  function doctor(name: string) {
    return spawnSync("bun", ["run", CLI, "cli", "skill", "doctor", name], {
      env: { ...process.env, PAL_HOME: resolve(ROOT, ".pal") },
      encoding: "utf-8",
      timeout: 15000,
    });
  }

  beforeAll(() => {
    mkdirSync(resolve(ROOT, ".pal/skills/clean"), { recursive: true });
    writeFileSync(
      resolve(ROOT, ".pal/skills/clean/SKILL.md"),
      GOOD.replace("good-skill", "clean")
    );
    mkdirSync(resolve(ROOT, ".pal/skills/Broken"), { recursive: true });
    writeFileSync(
      resolve(ROOT, ".pal/skills/Broken/SKILL.md"),
      GOOD.replace("good-skill", "UPPER")
    );
  });

  test("exits 0 for a clean skill", () => {
    const r = doctor("clean");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("PASS");
  });

  test("exits 1 when a skill has errors", () => {
    const r = doctor("Broken");
    expect(r.status).toBe(1);
  });

  test("exits 1 with usage when no name is given", () => {
    const r = spawnSync("bun", ["run", CLI, "cli", "skill", "doctor"], {
      env: { ...process.env, PAL_HOME: resolve(ROOT, ".pal") },
      encoding: "utf-8",
      timeout: 15000,
    });
    expect(r.status).toBe(1);
  });
});

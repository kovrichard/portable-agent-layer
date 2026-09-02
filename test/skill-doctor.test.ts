import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
    const target = resolve(dir, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

const GOOD = `---
name: good-skill
description: "Summarizes a thing into a report. Use when the user asks to summarize a thing."
metadata:
  triggers:
    - "good-skill"
    - "good skill"
    - "summarize a thing"
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

  test("a skill with no declared triggers warns", () => {
    const noTriggers = GOOD.replace(/metadata:\n(?: {2}.*\n| {4}.*\n)+/, "");

    expect(levelOf(fixture(noTriggers), "metadata.triggers")).toBe("warn");
  });

  test("a thin trigger list warns", () => {
    const thin = GOOD.replace('    - "summarize a thing"\n', "");

    expect(levelOf(fixture(thin), "metadata.triggers")).toBe("warn");
  });

  test("a full trigger list passes", () => {
    expect(levelOf(fixture(GOOD), "metadata.triggers")).toBe("pass");
  });

  test("a top-level triggers key does not count as declared", () => {
    const topLevel = GOOD.replace(/metadata:\n {2}triggers:/, "triggers:");

    expect(levelOf(fixture(topLevel), "metadata.triggers")).toBe("warn");
  });

  test("triggers leading with the skill name then its de-hyphenated form pass", () => {
    expect(levelOf(fixture(GOOD), "metadata.triggers.lead")).toBe("pass");
  });

  test("triggers not leading with the skill name warn", () => {
    const wrongFirst = GOOD.replace('    - "good-skill"\n', "");

    expect(levelOf(fixture(wrongFirst), "metadata.triggers.lead")).toBe("warn");
  });

  test("a missing de-hyphenated second trigger warns", () => {
    const wrongSecond = GOOD.replace('    - "good skill"\n', "");

    expect(levelOf(fixture(wrongSecond), "metadata.triggers.lead")).toBe("warn");
  });

  test("a single-word skill needs only its own name to lead", () => {
    const oneWord = GOOD.replaceAll("good-skill", "goodskill").replace(
      '    - "good skill"\n',
      ""
    );

    expect(levelOf(fixture(oneWord), "metadata.triggers.lead")).toBe("pass");
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

  test("a machine-specific absolute path in a script warns (not error)", () => {
    const dir = fixture(GOOD, {
      "tools/build.ts": 'const VAULT = "/Users/someone/Drive/vault";\n',
    });
    expect(levelOf(dir, "paths.absolute")).toBe("warn");
    expect(lintSkill(dir).errors).toBe(0);
  });

  test("absolute path in SKILL.md body itself is caught", () => {
    const dir = fixture(`${GOOD}\nStore output under /home/someone/out.\n`);
    expect(levelOf(dir, "paths.absolute")).toBe("warn");
  });

  test("portable $HOME and ~ paths do not trigger the absolute-path warning", () => {
    const dir = fixture(GOOD, {
      "tools/build.ts":
        'const P = "~/.pal/x";\nconst Q = process.env.HOME + "/.pal/y";\n',
    });
    expect(levelOf(dir, "paths.absolute")).toBe("pass");
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
    mkdirSync(resolve(ROOT, ".pal/skills/clean-skill"), { recursive: true });
    writeFileSync(
      resolve(ROOT, ".pal/skills/clean-skill/SKILL.md"),
      GOOD.replaceAll("good-skill", "clean-skill").replaceAll("good skill", "clean skill")
    );
    mkdirSync(resolve(ROOT, ".pal/skills/Broken"), { recursive: true });
    writeFileSync(
      resolve(ROOT, ".pal/skills/Broken/SKILL.md"),
      GOOD.replace("good-skill", "UPPER")
    );
  });

  test("exits 0 for a clean skill", () => {
    const r = doctor("clean-skill");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("PASS");
  });

  test("exits 1 when a skill has errors", () => {
    const r = doctor("Broken");
    expect(r.status).toBe(1);
  });

  test("--all reports every installed skill", () => {
    const r = doctor("--all");

    expect(r.stdout).toContain("clean-skill");
    expect(r.stdout).toContain("Broken");
    expect(r.stdout).toContain("2 skills");
  });

  test("--all exits 1 when any skill has errors", () => {
    expect(doctor("--all").status).toBe(1);
  });

  test("--all exits 0 and says so when there are no skills", () => {
    const emptyHome = resolve(ROOT, "empty-home");
    mkdirSync(resolve(emptyHome, "skills"), { recursive: true });
    const r = spawnSync("bun", ["run", CLI, "cli", "skill", "doctor", "--all"], {
      env: { ...process.env, PAL_HOME: emptyHome },
      encoding: "utf-8",
      timeout: 15000,
    });

    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("No skills found");
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

const SHIPPED = GOOD.replace(
  "metadata:\n",
  "metadata:\n  source: portable-agent-layer\n"
);

describe("license provenance", () => {
  test("shipped skill with no license and no derived-from warns", () => {
    expect(levelOf(fixture(SHIPPED), "license")).toBe("warn");
  });

  test("shipped skill with a license passes", () => {
    const md = SHIPPED.replace("name: good-skill\n", "name: good-skill\nlicense: MIT\n");
    expect(levelOf(fixture(md), "license")).toBe("pass");
  });

  test("shipped skill that names its origin passes without a license", () => {
    const md = SHIPPED.replace(
      "  source: portable-agent-layer\n",
      "  source: portable-agent-layer\n  derived-from: https://example.com/origin\n"
    );
    expect(levelOf(fixture(md), "license")).toBe("pass");
  });

  test("personal skill is not asked for a license", () => {
    expect(levelOf(fixture(GOOD), "license")).toBeUndefined();
  });
});

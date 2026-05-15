import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../cli.ts");

function setup(rulesTs: string, configJson: object, sourceTs: string) {
  const dir = mkdtempSync(join(tmpdir(), "klint-custom-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "klint.rules.ts"), rulesTs);
  writeFileSync(join(dir, "klint.config.json"), JSON.stringify(configJson, null, 2));
  writeFileSync(join(dir, "src", "subject.ts"), sourceTs);
  return dir;
}

function run(dir: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("bun", [CLI, "--config", dir], {
    encoding: "utf-8",
    timeout: 15000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? -1,
  };
}

const RULE_TS = `
export default {
  "no-trigger-word": {
    check({ files, root, fileContents }, violations) {
      for (const [file, content] of fileContents) {
        const lines = content.split("\\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes("TRIGGER")) {
            violations.push({
              file: file.replace(root + "/", ""),
              line: i + 1,
              message: "trigger word found",
            });
          }
        }
      }
    },
  },
};
`;

const CONFIG_BASE = { include: ["src"], rules: {} };

describe("custom rules auto-registration", () => {
  test("rule exported from klint.rules.ts fires without customRules in config", () => {
    const dir = setup(RULE_TS, CONFIG_BASE, `const x = "TRIGGER";\n`);
    try {
      const { stderr, code } = run(dir);
      expect(code).toBe(2);
      expect(stderr).toContain("no-trigger-word");
      expect(stderr).toContain("trigger word found");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("rules config can downgrade custom rule to warn", () => {
    const dir = setup(
      RULE_TS,
      { include: ["src"], rules: { "no-trigger-word": "warn" } },
      `const x = "TRIGGER";\n`
    );
    try {
      const { stderr, code } = run(dir);
      expect(code).toBe(0);
      expect(stderr).toContain("no-trigger-word");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("rules config can silence custom rule with off", () => {
    const dir = setup(
      RULE_TS,
      { include: ["src"], rules: { "no-trigger-word": "off" } },
      `const x = "TRIGGER";\n`
    );
    try {
      const { stdout, code } = run(dir);
      expect(code).toBe(0);
      expect(stdout).toContain("0 violations");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("no violations when source does not trigger the rule", () => {
    const dir = setup(RULE_TS, CONFIG_BASE, `const x = "safe";\n`);
    try {
      const { stdout, code } = run(dir);
      expect(code).toBe(0);
      expect(stdout).toContain("0 violations");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

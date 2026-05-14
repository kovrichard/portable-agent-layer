/**
 * PAL architectural lint rules — patterns biome/tsc/knip cannot enforce.
 *
 * Rules:
 *   no-console-in-hook-lib      console.log in src/hooks/lib/ (use logDebug/logError)
 *   no-raw-anthropic-fetch      api.anthropic.com fetch outside inference.ts
 *   no-raw-api-key-access       PAL_ANTHROPIC_API_KEY env read outside inference.ts
 *   no-unguarded-json-parse     JSON.parse() in src/ not wrapped in a try/catch (AST)
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

interface Violation {
  file: string;
  line: number;
  rule: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function scan(
  files: string[],
  pattern: RegExp,
  rule: string,
  root: string,
  violations: Violation[]
) {
  for (const file of files) {
    const lines = readFileSync(file, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        violations.push({ file: relative(root, file), line: i + 1, rule });
      }
    }
  }
}

function isInsideTry(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isTryStatement(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

function scanJsonParse(files: string[], root: string, violations: Violation[]) {
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const src = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);

    function walkAst(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "parse" &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "JSON" &&
        !isInsideTry(node)
      ) {
        const { line } = src.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          file: relative(root, file),
          line: line + 1,
          rule: "no-unguarded-json-parse",
        });
      }
      ts.forEachChild(node, walkAst);
    }

    walkAst(src);
  }
}

export function runArchCheck(root: string): Violation[] {
  const inference = resolve(root, "src/hooks/lib/inference.ts");
  const violations: Violation[] = [];

  // Rule 1: console.log in src/hooks/lib/ without import.meta.main guard
  for (const file of walk(resolve(root, "src/hooks/lib"))) {
    const content = readFileSync(file, "utf-8");
    if (content.includes("console.log") && !content.includes("import.meta.main")) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (/console\.log/.test(lines[i])) {
          violations.push({
            file: relative(root, file),
            line: i + 1,
            rule: "no-console-in-hook-lib",
          });
        }
      }
    }
  }

  // Rule 2: direct Anthropic API fetch outside inference.ts
  const allSrc = [
    ...walk(resolve(root, "src/hooks")),
    ...walk(resolve(root, "src/tools")),
  ].filter((f) => f !== inference);
  scan(allSrc, /api\.anthropic\.com/, "no-raw-anthropic-fetch", root, violations);

  // Rule 3: PAL_ANTHROPIC_API_KEY access outside inference.ts
  scan(
    allSrc,
    /process\.env\.PAL_ANTHROPIC_API_KEY/,
    "no-raw-api-key-access",
    root,
    violations
  );

  // Rule 4: JSON.parse without try/catch — AST walk across all of src/
  scanJsonParse(walk(resolve(root, "src")), root, violations);

  return violations;
}

function main() {
  const root = resolve(import.meta.dir, "../..");
  const violations = runArchCheck(root);

  if (violations.length === 0) {
    process.stdout.write(JSON.stringify({ output: "arch-check: 0 violations" }));
    process.exit(0);
  }

  const lines = violations.map((v) => `${v.file}:${v.line}  [${v.rule}]`);
  process.stderr.write(
    `arch-check: ${violations.length} violation(s)\n${lines.join("\n")}\n`
  );
  process.exit(2);
}

if (import.meta.main) main();

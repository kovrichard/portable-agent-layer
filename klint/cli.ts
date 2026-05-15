#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyFixes } from "./core/fixer";
import { runKlint } from "./core/runner";
import type { KlintConfig, KlintRule } from "./core/types";
import { BUILT_IN_RULES } from "./rules/index";

interface CliOptions {
  configDir?: string;
  rulesFile?: string;
}

export async function main(opts: CliOptions = {}): Promise<void> {
  const args = process.argv.slice(2);
  let configDir = opts.configDir;
  let rulesFile = opts.rulesFile;
  let fix = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) configDir = resolve(args[++i]);
    else if (args[i] === "--rules" && args[i + 1]) rulesFile = resolve(args[++i]);
    else if (args[i] === "--fix") fix = true;
    else if (args[i] === "--help" || args[i] === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  configDir ??= process.cwd();

  const configPath = resolve(configDir, "klint.config.json");
  if (!existsSync(configPath)) {
    process.stderr.write(`klint: no klint.config.json found at ${configPath}\n`);
    process.exit(1);
  }

  interface RawConfig {
    root?: string;
    include?: string[];
    rules?: KlintConfig["rules"];
    customRules?: string[];
  }
  let raw: RawConfig;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8")) as RawConfig;
  } catch {
    process.stderr.write(`klint: failed to parse ${configPath}\n`);
    process.exit(1);
  }
  const root = resolve(configDir, raw.root ?? ".");

  let customRules: KlintRule[] = [];
  const defaultRulesPath = resolve(configDir, "klint.rules.ts");
  const rulesPath =
    rulesFile ?? (existsSync(defaultRulesPath) ? defaultRulesPath : undefined);
  if (rulesPath) {
    const mod = await import(rulesPath);
    customRules = (mod.default ?? []) as KlintRule[];
  }

  const allRules: KlintConfig["rules"] = [
    ...(raw.rules ?? []),
    ...(raw.customRules ?? []),
  ];
  const violations = runKlint(
    { root, include: raw.include ?? ["."], rules: allRules },
    customRules
  );

  if (fix) {
    let totalApplied = 0;
    let current = violations;
    while (true) {
      const applied = applyFixes(current, root);
      totalApplied += applied;
      if (applied === 0) break;
      current = runKlint(
        { root, include: raw.include ?? ["."], rules: allRules },
        customRules
      );
      if (current.every((v) => !v.fix)) break;
    }
    const unfixed = current.filter((v) => !v.fix).length;
    const msg =
      unfixed > 0
        ? `klint: applied ${totalApplied} fix(es). ${unfixed} violation(s) require manual attention.`
        : `klint: applied ${totalApplied} fix(es). No remaining violations.`;
    process.stdout.write(JSON.stringify({ output: msg }));
    process.exit(0);
  }

  if (violations.length === 0) {
    process.stdout.write(JSON.stringify({ output: "klint: 0 violations" }));
    process.exit(0);
  }

  const blocks = violations.map((v) => {
    const header = `${v.file}:${v.line}  [${v.rule}]`;
    const sep = "━".repeat(Math.max(0, 80 - header.length));
    return `${header} ${sep}\n\n  × ${v.message}\n`;
  });
  process.stderr.write(
    `klint: ${violations.length} violation(s)\n\n${blocks.join("\n")}`
  );
  process.exit(2);
}

function printHelp(): void {
  const rules = Object.keys(BUILT_IN_RULES);
  process.stdout.write(
    [
      "klint — type-aware lint rules for TypeScript, written in TypeScript",
      "",
      "Usage: klint [--config <dir>] [--rules <file>] [--fix]",
      "",
      "  --config <dir>   directory containing klint.config.json (default: cwd)",
      "  --rules  <file>  custom rules file (default: <configDir>/klint.rules.ts if present)",
      "  --fix            apply auto-fixes for fixable violations in-place",
      "",
      `Built-in rules (${rules.length}):`,
      ...rules.map((r) => `  ${r}`),
      "",
    ].join("\n")
  );
}

if (import.meta.main) await main();

#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { applyFixes } from "./core/fixer";
import { runKlint } from "./core/runner";
import type { ArchConfig, KlintConfig, KlintRule, RuleConfigValue } from "./core/types";
import { BUILT_IN_PLUGINS } from "./plugins/index";
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

  const yamlPath = resolve(configDir, "klint.yaml");
  const jsonPath = resolve(configDir, "klint.config.json");
  const usingYaml = existsSync(yamlPath);
  const configPath = usingYaml ? yamlPath : jsonPath;

  if (!existsSync(configPath)) {
    process.stderr.write(
      `klint: no config file found — create klint.yaml (or klint.config.json) at ${configDir}\n`
    );
    process.exit(1);
  }

  interface RawConfig {
    root?: string;
    include?: string[];
    plugins?: string[];
    rules?: Record<string, RuleConfigValue>;
    arch?: unknown;
  }
  let raw: RawConfig;
  try {
    const text = readFileSync(configPath, "utf-8");
    raw = (usingYaml ? parseYaml(text) : JSON.parse(text)) as RawConfig;
  } catch {
    process.stderr.write(`klint: failed to parse ${configPath}\n`);
    process.exit(1);
  }
  const root = resolve(configDir, raw.root ?? ".");

  let customRules: Record<string, KlintRule> = {};
  const defaultRulesPath = resolve(configDir, "klint.rules.ts");
  const rulesPath =
    rulesFile ?? (existsSync(defaultRulesPath) ? defaultRulesPath : undefined);
  if (rulesPath) {
    const mod = await import(rulesPath);
    customRules = (mod.default ?? {}) as Record<string, KlintRule>;
  }

  const customRulesMap: Record<string, RuleConfigValue> = Object.fromEntries(
    Object.keys(customRules).map((name) => [name, "error" as const])
  );
  const allRules: KlintConfig["rules"] = { ...customRulesMap, ...(raw.rules ?? {}) };

  const violations = runKlint(
    {
      root,
      include: raw.include ?? ["."],
      plugins: raw.plugins,
      rules: allRules,
      arch: raw.arch as ArchConfig | undefined,
    },
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
        {
          root,
          include: raw.include ?? ["."],
          plugins: raw.plugins,
          rules: allRules,
          arch: raw.arch as ArchConfig | undefined,
        },
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

  const errors = violations.filter((v) => v.severity === "error");
  const warns = violations.filter((v) => v.severity === "warn");

  if (errors.length === 0 && warns.length === 0) {
    process.stdout.write(JSON.stringify({ output: "klint: 0 violations" }));
    process.exit(0);
  }

  const formatBlock = (v: (typeof violations)[number]) => {
    const prefix = v.severity === "warn" ? "⚠" : "×";
    const header = `${v.file}:${v.line}  [${v.rule}]`;
    const sep = "━".repeat(Math.max(0, 80 - header.length));
    return `${header} ${sep}\n\n  ${prefix} ${v.message}\n`;
  };

  if (warns.length > 0) {
    process.stderr.write(
      `klint: ${warns.length} warning(s)\n\n${warns.map(formatBlock).join("\n")}`
    );
  }
  if (errors.length > 0) {
    process.stderr.write(
      `klint: ${errors.length} error(s)\n\n${errors.map(formatBlock).join("\n")}`
    );
    process.exit(2);
  }
  process.exit(0);
}

function printHelp(): void {
  const pluginRules = new Set(
    Object.values(BUILT_IN_PLUGINS).flatMap((p) => Object.keys(p.rules))
  );
  const standaloneRules = Object.keys(BUILT_IN_RULES).filter((r) => !pluginRules.has(r));
  const pluginEntries = Object.entries(BUILT_IN_PLUGINS);

  process.stdout.write(
    [
      "klint — agent harness for TypeScript architecture rules",
      "",
      "Usage: klint [--config <dir>] [--rules <file>] [--fix]",
      "",
      "  --config <dir>   directory containing klint.yaml or klint.config.json (default: cwd)",
      "  --rules  <file>  custom rules file (default: <configDir>/klint.rules.ts if present)",
      "  --fix            apply auto-fixes for fixable violations in-place",
      "",
      `Built-in rules (${standaloneRules.length}):`,
      ...standaloneRules.map((r) => `  ${r}`),
      "",
      `Plugins (${pluginEntries.length}):`,
      ...pluginEntries.flatMap(([name, plugin]) => [
        `  ${name}`,
        ...Object.keys(plugin.rules).map((r) => `    ${r}`),
      ]),
      "",
    ].join("\n")
  );
}

if (import.meta.main) await main();

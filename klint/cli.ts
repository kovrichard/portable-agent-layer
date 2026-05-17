#!/usr/bin/env bun
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as clack from "@clack/prompts";
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

  if (args[0] === "install-skill") {
    await installSkill(args.slice(1));
    return;
  }

  let configDir = opts.configDir;
  let rulesFile = opts.rulesFile;
  let fix = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) configDir = resolve(args[++i]);
    else if (args[i] === "--rules" && args[i + 1]) rulesFile = resolve(args[++i]);
    else if (args[i] === "--fix") fix = true;
    else if (args[i] === "--json") json = true;
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

  if (json) {
    const errors = violations.filter((v) => v.severity === "error");
    process.stdout.write(
      JSON.stringify({
        violations: violations.map((v) => ({ ...v, fix: v.fix ?? null })),
        summary: { errors: errors.length, warnings: violations.length - errors.length },
      })
    );
    process.exit(errors.length > 0 ? 2 : 0);
  }

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

const AGENT_TARGETS = [
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "opencode" },
  { value: "cursor", label: "Cursor" },
  { value: "codex", label: "Codex" },
] as const;

type AgentKey = (typeof AGENT_TARGETS)[number]["value"];

const AGENT_DIRS: Record<AgentKey, string> = {
  claude: ".claude/skills",
  opencode: ".agents/skills",
  cursor: ".cursor/skills",
  codex: ".agents/skills",
};

async function installSkill(args: string[]): Promise<void> {
  const skillSrc = join(import.meta.dir, "skill", "klint-rules");
  if (!existsSync(skillSrc)) {
    process.stderr.write(`klint: skill source not found at ${skillSrc}\n`);
    process.exit(1);
  }

  // Parse non-interactive flags
  let flagAgents: AgentKey[] | undefined;
  let flagSymlink: boolean | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agents" && args[i + 1])
      flagAgents = args[++i].split(",") as AgentKey[];
    else if (args[i] === "--symlink") flagSymlink = true;
    else if (args[i] === "--copy") flagSymlink = false;
  }

  let selectedAgents: AgentKey[];
  let useSymlink: boolean;

  if (!process.stdin.isTTY || flagAgents !== undefined || flagSymlink !== undefined) {
    selectedAgents = flagAgents ?? (AGENT_TARGETS.map((a) => a.value) as AgentKey[]);
    useSymlink = flagSymlink ?? false;
  } else {
    clack.intro("klint install-skill");

    const agents = await clack.multiselect<AgentKey>({
      message: "Which agents should the skill be installed for?",
      options: AGENT_TARGETS.map((a) => ({ value: a.value, label: a.label })),
      initialValues: AGENT_TARGETS.map((a) => a.value) as AgentKey[],
    });
    if (clack.isCancel(agents)) {
      clack.cancel("Cancelled.");
      process.exit(0);
    }
    selectedAgents = agents as AgentKey[];

    const mode = await clack.select<"symlink" | "copy">({
      message: "Install as symlink or copy?",
      options: [
        {
          value: "symlink",
          label: "Symlink",
          hint: "stays in sync when klint updates",
        },
        {
          value: "copy",
          label: "Copy",
          hint: "one-time snapshot, no ongoing dependency",
        },
      ],
    });
    if (clack.isCancel(mode)) {
      clack.cancel("Cancelled.");
      process.exit(0);
    }
    useSymlink = mode === "symlink";
  }

  const cwd = process.cwd();
  const linkType = process.platform === "win32" ? "junction" : "dir";
  for (const key of selectedAgents) {
    const dest = resolve(cwd, AGENT_DIRS[key], "klint-rules");
    mkdirSync(dirname(dest), { recursive: true });
    try {
      rmSync(dest, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
    if (useSymlink) {
      symlinkSync(relative(dirname(dest), skillSrc), dest, linkType);
    } else {
      cpSync(skillSrc, dest, { recursive: true });
    }
  }

  if (process.stdin.isTTY) {
    clack.outro("Done.");
  }
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
      "Usage: klint [--config <dir>] [--rules <file>] [--fix] [--json]",
      "       klint install-skill [--out <path>]",
      "",
      "  --config <dir>   directory containing klint.yaml or klint.config.json (default: cwd)",
      "  --rules  <file>  custom rules file (default: <configDir>/klint.rules.ts if present)",
      "  --fix            apply auto-fixes for fixable violations in-place",
      "  --json           emit structured JSON to stdout (for agent/CI consumption)",
      "",
      "  install-skill    install the rule-authoring skill into agent config directories",
      "                   --agents <list>  comma-separated: claude,opencode,cursor,codex (default: all)",
      "                   --symlink        install as symlink (stays in sync with updates)",
      "                   --copy           install as copy (default in non-TTY)",
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

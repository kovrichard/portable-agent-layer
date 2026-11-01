import { existsSync, lstatSync, readlinkSync, renameSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { palHome, paths, platform } from "../hooks/lib/paths";
import { readJson, writeJson } from "../targets/lib";

/** Something an older PAL wrote that the current one neither writes nor reads. */
export interface Leftover {
  id: string;
  description: string;
  find(): string[];
  remove(): void;
}

type Json = Record<string, unknown>;

const claudeSettings = () => resolve(platform.claudeDir(), "settings.json");
const palSettings = () => resolve(paths.memory(), "pal-settings.json");

function isPathScopedFileToolRule(rule: string): boolean {
  return /^(?:Grep|Glob)\(/.test(rule);
}

function allowRulesIn(settingsPath: string): string[] {
  const settings = readJson<Json>(settingsPath, {});
  const allow = (settings.permissions as { allow?: unknown } | undefined)?.allow;
  return Array.isArray(allow)
    ? allow.filter((r): r is string => typeof r === "string")
    : [];
}

const claudeAllowRules = () => allowRulesIn(claudeSettings());

const claudeFileToolRules: Leftover = {
  id: "claude-file-tool-rules",
  description:
    "Remove Grep()/Glob() allow rules older templates wrote — Claude Code ignores them and warns on every prompt",
  find: () => claudeAllowRules().filter(isPathScopedFileToolRule),
  remove() {
    const settings = readJson<Json>(claudeSettings(), {});
    const permissions = settings.permissions as { allow: string[] };
    permissions.allow = permissions.allow.filter(
      (rule) => !isPathScopedFileToolRule(rule)
    );
    writeJson(claudeSettings(), settings);
  },
};

const palWrittenFactoryHome = () => resolve(palHome(), "dark-factory");

function pinnedFactoryHome(): string | null {
  const env = (readJson<Json>(claudeSettings(), {}).env ?? {}) as Json;
  const value = env.DARK_FACTORY_HOME;
  return typeof value === "string" && resolve(value) === palWrittenFactoryHome()
    ? value
    : null;
}

const claudeFactoryHomeOverride: Leftover = {
  id: "claude-factory-home-override",
  description:
    "Remove the DARK_FACTORY_HOME PAL wrote into Claude Code settings, so the factory keeps its own home under ~/.dark-factory",
  find: () => (pinnedFactoryHome() ? ["env.DARK_FACTORY_HOME"] : []),
  remove() {
    const settings = readJson<Json>(claudeSettings(), {});
    const env = settings.env as Json;
    delete env.DARK_FACTORY_HOME;
    if (Object.keys(env).length === 0) delete settings.env;
    writeJson(claudeSettings(), settings);
  },
};

function startupFiles(): string[] {
  const settings = readJson<Json>(palSettings(), {});
  const files = (settings.loadAtStartup as { files?: unknown } | undefined)?.files;
  return Array.isArray(files)
    ? files.filter((f): f is string => typeof f === "string")
    : [];
}

const isProjectsFile = (file: string) => file.endsWith("PROJECTS.md");

const startupProjectsFile: Leftover = {
  id: "startup-projects-md",
  description:
    "Stop loading PROJECTS.md at startup — projects moved to the project store",
  find: () => startupFiles().filter(isProjectsFile),
  remove() {
    const settings = readJson<Json>(palSettings(), {});
    const startup = settings.loadAtStartup as { files: string[] };
    startup.files = startup.files.filter((file) => !isProjectsFile(file));
    writeJson(palSettings(), settings);
  },
};

const oldOpencodePlugin = () =>
  resolve(platform.opencodeDir(), "plugins", "pai-plugin.ts");

const opencodePluginOldName: Leftover = {
  id: "opencode-pai-plugin",
  description: "Remove the opencode plugin under its old name, pai-plugin.ts",
  find: () => (existsSync(oldOpencodePlugin()) ? [oldOpencodePlugin()] : []),
  remove: () => unlinkSync(oldOpencodePlugin()),
};

const oldCopilotInstructions = () =>
  resolve(platform.copilotDir(), "copilot-instructions.md");

function linksToAgentsMd(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink() && readlinkSync(path).includes("AGENTS.md");
  } catch {
    return false;
  }
}

const copilotInstructionsLink: Leftover = {
  id: "copilot-instructions-link",
  description:
    "Remove the copilot-instructions.md link to AGENTS.md — Copilot now reads PAL's own instruction files",
  find: () =>
    linksToAgentsMd(oldCopilotInstructions()) ? [oldCopilotInstructions()] : [],
  remove: () => unlinkSync(oldCopilotInstructions()),
};

const opencodeConfig = () => resolve(platform.opencodeDir(), "config.json");

function opencodeInstructions(): string[] {
  const instructions = readJson<Json>(opencodeConfig(), {}).instructions;
  return Array.isArray(instructions)
    ? instructions.filter((i): i is string => typeof i === "string")
    : [];
}

interface RetiredContextSource {
  id: string;
  name: string;
  slug: string;
  digest: () => string;
}

function retiredContextSource(source: RetiredContextSource): Leftover {
  const copies = () =>
    [
      resolve(platform.cursorDir(), "rules", `pal-${source.slug}.mdc`),
      resolve(
        platform.copilotDir(),
        "instructions",
        `pal-${source.slug}.instructions.md`
      ),
      resolve(platform.antigravityPluginDir(), "rules", `pal-${source.slug}.md`),
    ].filter((path) => existsSync(path));
  const opencodeLoadsIt = () => opencodeInstructions().includes(source.digest());
  return {
    id: source.id,
    description: `Stop loading the ${source.name} into Cursor, Copilot, Antigravity and opencode — PAL no longer writes it`,
    find: () => [
      ...copies(),
      ...(opencodeLoadsIt() ? [`${opencodeConfig()}#instructions`] : []),
    ],
    remove() {
      for (const path of copies()) unlinkSync(path);
      if (!opencodeLoadsIt()) return;
      const config = readJson<Json>(opencodeConfig(), {});
      config.instructions = opencodeInstructions().filter((i) => i !== source.digest());
      writeJson(opencodeConfig(), config);
    },
  };
}

const failuresDigestContext = retiredContextSource({
  id: "failures-digest-context",
  name: "failures digest",
  slug: "failures",
  digest: () => resolve(paths.memory(), "learning", "failures-digest.md"),
});

const selfModelContext = retiredContextSource({
  id: "self-model-context",
  name: "self-model",
  slug: "self-model",
  digest: () => resolve(paths.memory(), "self-model", "current.md"),
});

const wisdomContext = retiredContextSource({
  id: "wisdom-context",
  name: "wisdom digest",
  slug: "wisdom",
  digest: () => resolve(paths.memory(), "wisdom", "context.md"),
});

const RETIRED_VERBS = ["relationship-note", "wisdom-frame", "handoff-note", "thread"];

const isRetiredVerbRule = (rule: string) =>
  RETIRED_VERBS.some(
    (verb) => rule === `Bash(pal cli ${verb} *)` || rule === `command(pal cli ${verb})`
  );

const settingsWithRetiredVerbs = () =>
  [claudeSettings(), platform.antigravitySettings()].filter((path) =>
    allowRulesIn(path).some(isRetiredVerbRule)
  );

const retiredVerbRules: Leftover = {
  id: "retired-verb-rules",
  description:
    "Remove the allow rules for the relationship-note, wisdom-frame, handoff-note and thread verbs — those commands are gone",
  find: () =>
    settingsWithRetiredVerbs().flatMap((path) =>
      allowRulesIn(path).filter(isRetiredVerbRule)
    ),
  remove() {
    for (const path of settingsWithRetiredVerbs()) {
      const settings = readJson<Json>(path, {});
      const permissions = settings.permissions as { allow: string[] };
      permissions.allow = permissions.allow.filter((rule) => !isRetiredVerbRule(rule));
      writeJson(path, settings);
    }
  },
};

const opinionTrackingDoc = () => resolve(palHome(), "docs", "OPINION_TRACKING.md");

const opinionTrackingDocCopy: Leftover = {
  id: "opinion-tracking-doc",
  description:
    "Remove OPINION_TRACKING.md — it described the opinion skill, which no longer ships",
  find: () => (existsSync(opinionTrackingDoc()) ? [opinionTrackingDoc()] : []),
  remove: () => unlinkSync(opinionTrackingDoc()),
};

const debugLog = () => resolve(paths.debug(), "debug.log");

const debugLogPrev: Leftover = {
  id: "debug-log-prev",
  description: "Rename the old single rotated debug log, debug.log.prev, to debug.log.1",
  find: () => (existsSync(`${debugLog()}.prev`) ? [`${debugLog()}.prev`] : []),
  remove() {
    const prev = `${debugLog()}.prev`;
    if (existsSync(`${debugLog()}.1`)) unlinkSync(prev);
    else renameSync(prev, `${debugLog()}.1`);
  },
};

export const LEFTOVERS: Leftover[] = [
  claudeFileToolRules,
  claudeFactoryHomeOverride,
  startupProjectsFile,
  opencodePluginOldName,
  copilotInstructionsLink,
  failuresDigestContext,
  selfModelContext,
  wisdomContext,
  retiredVerbRules,
  opinionTrackingDocCopy,
  debugLogPrev,
];

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "../../hooks/lib/paths";
import type { Migration, MigrationResult } from "./migration";

const RETIRED_SETTINGS_KEYS: Record<string, string[]> = {
  loadAtStartup: ["_docs"],
  steering: ["_docs"],
  dynamicContext: [
    "_docs",
    "learningDigest",
    "projectHistory",
    "sessionIntelligence",
    "synthesis",
    "signalTrends",
    "activeWork",
    "failurePatterns",
    "learningInjection",
    "wisdom",
    "relationship",
    "selfModel",
    "handoff",
    "workTree",
    "workTreeGate",
    "workTreeDecisionGate",
    "progressTree",
    "progressTreeGate",
    "progressTreeDecisionGate",
  ],
};

function settingsFile(): string {
  return resolve(paths.memory(), "pal-settings.json");
}

function readSettingsObject(): Record<string, Record<string, unknown>> | null {
  try {
    const settings = JSON.parse(readFileSync(settingsFile(), "utf-8"));

    return typeof settings === "object" && settings !== null ? settings : null;
  } catch {
    return null;
  }
}

function writeSettingsObject(settings: Record<string, Record<string, unknown>>): void {
  writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

export function retiredKeysIn(
  settings: Record<string, Record<string, unknown>>
): string[] {
  return Object.entries(RETIRED_SETTINGS_KEYS).flatMap(([section, keys]) => {
    const value = settings[section];
    if (typeof value !== "object" || value === null) return [];

    return keys.filter((key) => key in value).map((key) => `${section}.${key}`);
  });
}

export const v7RetiredSettingsKeys: Migration = {
  id: "v7-retired-settings-keys",
  description: "Remove settings older templates wrote that PAL no longer reads",

  check() {
    const settings = readSettingsObject();
    const retired = settings ? retiredKeysIn(settings) : [];

    return {
      pending: retired.length > 0,
      detail: retired.length > 0 ? retired.join(", ") : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const settings = readSettingsObject();
    const retired = settings ? retiredKeysIn(settings) : [];
    if (!settings || retired.length === 0)
      return { migrated: 0, skipped: 0, results: [] };

    if (!dryRun) {
      for (const path of retired) {
        const [section, key] = path.split(".");
        delete settings[section][key];
      }

      writeSettingsObject(settings);
    }

    const verb = dryRun ? "would remove" : "removed";

    return {
      migrated: retired.length,
      skipped: 0,
      results: [`pal-settings.json: ${verb} ${retired.join(", ")}`],
    };
  },
};

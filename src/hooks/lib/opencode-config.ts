import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { platform } from "./paths";

const GLOBAL_CONFIG_FILES = ["config.json", "opencode.json", "opencode.jsonc"];

type OpencodeConfig = Record<string, unknown>;

function readConfig(name: string): OpencodeConfig | null {
  try {
    const config = Bun.JSONC.parse(
      readFileSync(resolve(platform.opencodeDir(), name), "utf-8")
    );
    return config && typeof config === "object" ? (config as OpencodeConfig) : null;
  } catch {
    return null;
  }
}

function pinnedModel(config: OpencodeConfig | null): string | null {
  return typeof config?.model === "string" && config.model ? config.model : null;
}

/** Without a pinned model, `opencode run` falls back to whatever was last picked in the TUI. */
export function opencodeBackgroundModel(): string | null {
  for (const name of GLOBAL_CONFIG_FILES) {
    const model = pinnedModel(readConfig(name));
    if (model) return model;
  }
  return null;
}

function withoutInstructions(config: OpencodeConfig): OpencodeConfig {
  const { instructions: _, ...rest } = config;
  return rest;
}

/**
 * opencode loads the global AGENTS.md and every `instructions` file into each run,
 * so PAL's identity and output format would reach background inference too.
 */
export function writeInstructionFreeConfig(configHome: string): void {
  const dir = resolve(configHome, "opencode");
  mkdirSync(dir, { recursive: true });
  for (const name of GLOBAL_CONFIG_FILES) {
    const config = readConfig(name);
    if (config)
      writeFileSync(resolve(dir, name), JSON.stringify(withoutInstructions(config)));
  }
}

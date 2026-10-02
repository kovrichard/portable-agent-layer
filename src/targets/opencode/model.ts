import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { platform } from "../../hooks/lib/paths";

const GLOBAL_CONFIG_FILES = ["config.json", "opencode.json", "opencode.jsonc"];

function pinnedModel(file: string): string | null {
  try {
    const config = Bun.JSONC.parse(readFileSync(file, "utf-8")) as { model?: unknown };
    return typeof config?.model === "string" && config.model ? config.model : null;
  } catch {
    return null;
  }
}

/** Without a pinned model, `opencode run` falls back to whatever was last picked in the TUI. */
export function opencodeBackgroundModel(): string | null {
  for (const name of GLOBAL_CONFIG_FILES) {
    const model = pinnedModel(resolve(platform.opencodeDir(), name));
    if (model) return model;
  }
  return null;
}

import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Skill source root: this file lives at <skill>/tools/lib/paths.ts → up two = skill root.
export const SKILL_ROOT = resolve(here, "..", "..");
export const VENDOR_REVEAL = join(SKILL_ROOT, "vendor", "reveal");
export const THEME_BASE = join(SKILL_ROOT, "theme-base");
export const SKILL_TEMPLATE = join(SKILL_ROOT, "template");
export const SKILL_DEMO = join(SKILL_ROOT, "demo");

// User-data — runtime templates registered by setup-template.
export const TEMPLATES_ROOT = join(homedir(), ".pal-data", "presentation-templates");
export const REGISTRY_PATH = join(TEMPLATES_ROOT, "registry.json");

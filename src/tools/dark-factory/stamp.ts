import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { HAIKU_5_5_MODEL, OPUS_MODEL, SONNET_MODEL } from "../../hooks/lib/models";

type FactoryTier = "small" | "medium" | "large";

export const FACTORY_MODELS: Record<FactoryTier, string> = {
  small: HAIKU_5_5_MODEL,
  medium: SONNET_MODEL,
  large: OPUS_MODEL,
};

export const ROLE_TIERS: Record<string, FactoryTier> = {
  po: "large",
  architect: "large",
  planner: "large",
  "test-writer": "medium",
  "code-writer": "small",
  debugger: "large",
  reviewer: "medium",
  tester: "medium",
};

export const PLUGIN_DIR = resolve(
  import.meta.dir,
  "../../../assets/plugins/dark-factory"
);

const MODEL_LINE = /^model: .*$/m;
const MODELS_CONST = /^const MODELS = \{.*\}$/m;

export function stampAgent(content: string, model: string): string {
  if (!MODEL_LINE.test(content)) throw new Error("agent file has no model line to stamp");
  return content.replace(MODEL_LINE, `model: ${model}`);
}

export function stampWorkflow(
  content: string,
  models: Record<FactoryTier, string>
): string {
  if (!MODELS_CONST.test(content))
    throw new Error("workflow has no MODELS constant to stamp");
  const entries = Object.entries(models).map(([tier, model]) => `${tier}: '${model}'`);
  return content.replace(MODELS_CONST, `const MODELS = { ${entries.join(", ")} }`);
}

function roleOf(file: string): string {
  const role = basename(file, ".md");
  if (!ROLE_TIERS[role]) throw new Error(`agents/${role}.md has no tier in ROLE_TIERS`);
  return role;
}

export function stampedFiles(pluginDir = PLUGIN_DIR): Map<string, string> {
  const files = new Map<string, string>();
  const agentsDir = join(pluginDir, "agents");
  for (const file of readdirSync(agentsDir).filter((name) => name.endsWith(".md"))) {
    const path = join(agentsDir, file);
    const tier = ROLE_TIERS[roleOf(file)] as FactoryTier;
    files.set(path, stampAgent(readFileSync(path, "utf8"), FACTORY_MODELS[tier]));
  }
  const workflow = join(pluginDir, "workflows", "build.js");
  files.set(workflow, stampWorkflow(readFileSync(workflow, "utf8"), FACTORY_MODELS));
  return files;
}

if (import.meta.main) {
  for (const [path, content] of stampedFiles()) writeFileSync(path, content);
}

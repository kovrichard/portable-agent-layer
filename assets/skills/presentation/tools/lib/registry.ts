import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { REGISTRY_PATH, TEMPLATES_ROOT } from "./paths";

export type LogoPlacement = "cover-only" | "footer" | "both" | "none";
export type Aspect = "16:9" | "4:3" | "16:10";

export type TemplateMeta = {
  primary: string;
  accent: string;
  footer: string;
  logoPlacement: LogoPlacement;
  fonts: string;
  aspect: Aspect;
};

export type TemplateEntry = {
  name: string;
  path: string;
  meta: TemplateMeta;
};

export type Registry = Record<string, TemplateEntry>;

export async function loadRegistry(): Promise<Registry> {
  try {
    const raw = await readFile(REGISTRY_PATH, "utf8");
    return JSON.parse(raw) as Registry;
  } catch {
    return {};
  }
}

export async function saveRegistry(reg: Registry): Promise<void> {
  await mkdir(TEMPLATES_ROOT, { recursive: true });
  const tmp = `${REGISTRY_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(reg, null, 2), "utf8");
  await rename(tmp, REGISTRY_PATH);
}

export async function registerTemplate(entry: TemplateEntry): Promise<void> {
  const reg = await loadRegistry();
  reg[entry.name] = entry;
  await saveRegistry(reg);
}

export async function getTemplate(name: string): Promise<TemplateEntry> {
  const reg = await loadRegistry();
  if (!(name in reg)) {
    throw new Error(
      `template "${name}" not registered. Run setup-template.ts first or check 'list-templates.ts'.`
    );
  }
  return reg[name];
}

export async function listTemplates(): Promise<TemplateEntry[]> {
  const reg = await loadRegistry();
  return Object.values(reg);
}

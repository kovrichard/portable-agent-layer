import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { assets, palHome } from "../hooks/lib/paths";
import { log } from "./log";

/** Copy template files into telos/ without overwriting existing ones */
export function scaffoldTelos(): void {
  const templatesDir = assets.telosTemplates();
  const telosDir = resolve(palHome(), "telos");
  if (!existsSync(templatesDir)) return;
  mkdirSync(telosDir, { recursive: true });

  for (const file of readdirSync(templatesDir).filter((f) => f.endsWith(".md"))) {
    const src = resolve(templatesDir, file);
    const dst = resolve(telosDir, file);
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
      log.info(`Created ${file} from template`);
    }
  }
}

/** Copy pal-settings.json template to memory/ without overwriting */
export function scaffoldPalSettings(): void {
  const src = resolve(assets.skills(), "..", "templates", "pal-settings.json");
  if (!existsSync(src)) return;

  const memDir = resolve(palHome(), "memory");
  mkdirSync(memDir, { recursive: true });

  const dst = resolve(memDir, "pal-settings.json");
  if (!existsSync(dst)) {
    copyFileSync(src, dst);
    log.info("Created pal-settings.json from template");
  }
}

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { assets, palHome } from "../core/paths";
import { settingsPath } from "../core/settings";
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

/** Copy the settings template into place without overwriting, old place included. */
export function scaffoldPalSettings(): void {
  const src = resolve(assets.skills(), "..", "templates", "settings.json");
  if (!existsSync(src)) return;

  const dst = settingsPath();
  if (existsSync(dst)) return;

  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  log.info(`Created ${relative(palHome(), dst)} from template`);
}

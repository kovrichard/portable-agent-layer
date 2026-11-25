import { relative } from "node:path";
import { archivePathIn, currentArchivePath } from "../bronze/bronze";
import type { ArchiveLayout } from "../core/import-merge";
import { SETTINGS_FILE, settingsPath } from "../core/settings";

const FORMER_SETTINGS = "memory/pal-settings.json";

function canonical(path: string): string {
  const current = currentArchivePath(path);

  return current === FORMER_SETTINGS ? SETTINGS_FILE : current;
}

/**
 * How an archive from any layout meets this machine: moved stores and the
 * settings file each land where this machine keeps them now, which is the old
 * place until the owner has run that move here.
 */
export function archiveLayoutFor(home: string): ArchiveLayout {
  return {
    canonical,
    here: (path) =>
      path === SETTINGS_FILE
        ? relative(home, settingsPath(home)).replaceAll("\\", "/")
        : archivePathIn(path, home),
  };
}

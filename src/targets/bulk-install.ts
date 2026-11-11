import { log } from "./log";

/**
 * Run one step of a bulk install, naming it only when it fails.
 *
 * Installs handle dozens of skills and agents; a line each buries the paths,
 * backups and warnings that a reader actually has to act on. Returning false
 * instead of throwing keeps one unlinkable skill from aborting the rest; the
 * error-level log still fails the install once every step has run.
 */
export function reportOnlyOnFailure(label: string, install: () => void): boolean {
  try {
    install();
    return true;
  } catch (e) {
    log.error(`Could not install ${label} — ${(e as Error).message}`);
    return false;
  }
}

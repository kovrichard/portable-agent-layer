/**
 * Stop handler: check if README.md is out of sync with code.
 *
 * Runs git diff to see if documentable files changed in this session.
 * If they did and README is stale, returns a block decision.
 */

import { execSync } from "node:child_process";
import { logDebug } from "../lib/log";
import { palPkg } from "../lib/paths";
import { validateReadmeSync, WATCHED_PATHS } from "../lib/readme-sync";

/** Check if any watched files have uncommitted changes. */
function hasDocumentableChanges(): boolean {
  try {
    const diff = execSync("git diff --name-only HEAD", {
      cwd: palPkg(),
      encoding: "utf-8",
    }).trim();

    const staged = execSync("git diff --name-only --cached", {
      cwd: palPkg(),
      encoding: "utf-8",
    }).trim();

    const changed = `${diff}\n${staged}`.split("\n").filter((f) => f.length > 0);

    return changed.some((file) =>
      WATCHED_PATHS.some((watched) => file === watched || file.startsWith(`${watched}/`))
    );
  } catch {
    return false;
  }
}

interface ReadmeSyncDecision {
  decision?: "block";
  reason?: string;
}

/** Returns a block decision if README is stale, or empty object to allow stop. */
export function checkReadmeSync(): ReadmeSyncDecision {
  if (!hasDocumentableChanges()) {
    logDebug("readme-sync", "No documentable changes detected");
    return {};
  }

  logDebug("readme-sync", "Documentable files changed — validating README");
  const result = validateReadmeSync();

  if (!result.ok) {
    logDebug("readme-sync", `README out of sync: ${result.issues.join("; ")}`);
    const issueList = result.issues.map((i) => `- ${i}`).join("\n");
    return {
      decision: "block",
      reason: `README.md is out of date. Please update it before finishing:\n${issueList}`,
    };
  }

  logDebug("readme-sync", "README is in sync");
  return {};
}

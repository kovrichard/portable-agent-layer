/**
 * Daily unattended updates — one-time opt-in prompt.
 *
 * Asked once during `pal install`, the same seam git attribution uses, so a new
 * user sees it at init and an existing one on their next update. The non-TTY
 * guard is load-bearing twice over: it keeps CI silent, and it keeps the
 * reinstall at the end of an unattended update from waiting on an answer nobody
 * is there to give.
 */

import * as clack from "@clack/prompts";
import { isRepoMode } from "../hooks/handlers/update-check";
import { raw as readSettings, write as writeSettings } from "../hooks/lib/settings";

/** Only a git clone can be mid-change; a global package install has no such state. */
function whatItDoes(): string {
  const daily =
    "Once a day, when you close a session, PAL updates itself in the background.\nOpening PAL is never slowed down, and the statusline says when to restart.";
  return isRepoMode()
    ? `${daily}\nIt waits while this clone has uncommitted changes.`
    : daily;
}

export async function promptAutoUpdate(): Promise<void> {
  if (!process.stdin.isTTY) return;

  const settings = { ...readSettings() };
  if (settings.autoUpdate?.decided) return;

  clack.intro("Automatic updates");
  clack.note(whatItDoes(), "Keep PAL up to date on its own?");

  const enabled = await clack.confirm({
    message: "Turn on daily automatic updates?",
    initialValue: false,
  });
  if (clack.isCancel(enabled)) {
    clack.cancel("Skipped — will ask again next time");
    return;
  }

  settings.autoUpdate = { enabled: enabled === true, decided: true };
  writeSettings(settings);
  const state = enabled ? "Daily updates on" : "Daily updates off";
  clack.outro(`${state} ✓  ·  change later: control room → Settings → Updates`);
}

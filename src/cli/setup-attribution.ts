/**
 * Optional git co-author attribution — one-time opt-in prompt.
 *
 * Asked once during `pal install` (covers fresh init and the reinstall that
 * `pal cli update` runs). The `decided` flag makes it ask exactly once: new
 * users see it at init, existing users see it on their next update, nobody is
 * nagged again. The choice is applied to ~/.claude/settings.json at install time.
 */

import * as clack from "@clack/prompts";
import {
  identity,
  raw as readSettings,
  write as writeSettings,
} from "../hooks/lib/settings";
import { buildAttributionText } from "../targets/lib";

/** Prompt once for git attribution opt-in. No-op if already decided or non-TTY. */
export async function promptAttribution(): Promise<void> {
  if (!process.stdin.isTTY) return;

  const settings = { ...readSettings() };
  if (settings.attribution?.decided) return;

  const name = identity().ai.name;
  const { commit, pr } = buildAttributionText(name);

  clack.intro("Git attribution");
  clack.note(
    `commit: ${commit}\npr:     ${pr}`,
    `Credit ${name} on the commits & PRs it makes?`
  );

  const enabled = await clack.confirm({
    message: `Add this ${name} co-author credit?`,
    initialValue: true,
  });
  if (clack.isCancel(enabled)) {
    clack.cancel("Skipped — will ask again next time");
    return;
  }

  settings.attribution = { enabled: enabled === true, decided: true };
  writeSettings(settings);
  const state = enabled ? `${name} attribution on` : "Attribution off";
  clack.outro(
    `${state} ✓  ·  change later: edit pal-settings.json, then run 'pal install'`
  );
}

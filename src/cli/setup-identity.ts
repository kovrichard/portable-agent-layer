/**
 * Interactive identity setup — prompts for missing fields in pal-settings.json.
 * Called during `pal install`. Skips fields that already have values.
 */

import * as clack from "@clack/prompts";
import {
  type PalSettingsData,
  raw as readSettings,
  write as writeSettings,
} from "../hooks/lib/settings";

/** Prompt for missing identity fields. Skips any field that already has a value. */
export async function promptIdentity(): Promise<void> {
  // Skip interactive prompts in non-TTY environments (tests, CI)
  if (!process.stdin.isTTY) return;

  const settings: PalSettingsData = { ...readSettings() };
  if (!settings.identity) settings.identity = {};
  if (!settings.identity.ai) settings.identity.ai = {};
  if (!settings.identity.principal) settings.identity.principal = {};

  const ai = settings.identity.ai;
  const principal = settings.identity.principal;

  // Check if anything is missing
  const needsPrincipal = !principal.name;
  const needsAi = !ai.name;
  const needsCatchphrase = !ai.catchphrase;
  const needsTimezone = !principal.timezone;

  if (!needsPrincipal && !needsAi && !needsCatchphrase && !needsTimezone) {
    clack.log.info("Identity already configured");
    return;
  }

  clack.intro("Identity Setup");

  if (needsPrincipal) {
    const name = await clack.text({
      message: "What's your name?",
      placeholder: "e.g. John",
      validate: (v) => (!v || v.length === 0 ? "Name is required" : undefined),
    });
    if (clack.isCancel(name)) {
      clack.cancel("Setup cancelled");
      return;
    }
    principal.name = name;
  }

  if (needsAi) {
    const name = await clack.text({
      message: "Name your AI",
      defaultValue: "Assistant",
      placeholder: "e.g. Jarvis, Friday, Atlas",
    });
    if (clack.isCancel(name)) {
      clack.cancel("Setup cancelled");
      return;
    }
    ai.name = name;
    ai.fullName = `${name} — Personal AI`;
    ai.displayName = name.toUpperCase();
  }

  if (needsCatchphrase) {
    const catchphrase = await clack.text({
      message: "Startup catchphrase ({name} gets replaced with AI name)",
      defaultValue: "{name} here, ready when you are.",
      placeholder: "{name} online. What's the mission?",
    });
    if (clack.isCancel(catchphrase)) {
      clack.cancel("Setup cancelled");
      return;
    }
    ai.catchphrase = catchphrase;
  }

  if (needsTimezone) {
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tz = await clack.text({
      message: "Your timezone",
      defaultValue: guess,
    });
    if (clack.isCancel(tz)) {
      clack.cancel("Setup cancelled");
      return;
    }
    principal.timezone = tz;
  }

  writeSettings(settings);
  clack.outro("Identity saved ✓");
}

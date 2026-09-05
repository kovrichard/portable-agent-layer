/**
 * pal cli telos / pal cli timezone — the personal context PAL carries about you.
 *
 *   pal cli telos             Which TELOS topics are answered, in interview order
 *   pal cli timezone          Show the configured timezone
 *   pal cli timezone <zone>   Set it, if Intl recognises the name
 *
 * Both exist for the onboarding skill. pal-settings.json is hook-protected, so
 * an agent cannot write the timezone itself, and a skill that restated the
 * answered/unanswered rule in prose would drift from the code that decides it.
 */

import {
  identity,
  raw as readSettings,
  write as writeSettings,
} from "../hooks/lib/settings";
import { telosStatus } from "../hooks/lib/telos-topics";
import { canonicalTimeZone } from "../hooks/lib/wall-clock";
import { log } from "../targets/lib";

export function runTelos(args: string[]): number {
  if (args.length > 0) {
    log.error(`Unknown telos argument: ${args[0]}`);
    log.info("Usage: pal cli telos");
    return 1;
  }

  const topics = telosStatus();
  for (const topic of topics) {
    const mark = topic.answered ? "answered " : "unanswered";
    const tier = topic.priority ? "" : "  (optional)";
    console.log(`  ${mark}  ${topic.key.padEnd(11)} ${topic.file}${tier}`);
  }

  const next = topics.find((topic) => topic.priority && !topic.answered);
  console.log("");
  console.log(next ? `next: ${next.key}` : "next: none — every priority topic answered");
  return 0;
}

export function runTimezone(args: string[]): number {
  const requested = args.join(" ").trim();

  if (!requested) {
    const current = identity().principal.timezone;
    console.log(
      current ? `timezone: ${current}` : "timezone: not set — times read as UTC"
    );
    return 0;
  }

  const zone = canonicalTimeZone(requested);
  if (!zone) {
    log.error(`Not a timezone Intl recognises: ${requested}`);
    log.info("Use an IANA name — Europe/Budapest, America/New_York, Asia/Tokyo");
    return 1;
  }

  const settings = { ...readSettings() };
  settings.identity ??= {};
  settings.identity.principal ??= {};
  settings.identity.principal.timezone = zone;
  writeSettings(settings);
  log.success(`timezone: ${zone}`);
  return 0;
}

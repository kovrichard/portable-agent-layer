/**
 * A nag the Discord bot sent, and how long the user took to answer it. The bot
 * runs outside PAL, so it reports both through `pal cli events discord-nag`.
 */

import { appendEvent } from "./events";

export const NAG_STAGES = ["sent", "answered"] as const;
export type NagStage = (typeof NAG_STAGES)[number];

export function isNagStage(value: unknown): value is NagStage {
  return typeof value === "string" && (NAG_STAGES as readonly string[]).includes(value);
}

export function logDiscordNag(
  stage: NagStage,
  kind: string | null,
  responseSec: number | null
): string | null {
  return appendEvent("discord_nag", {
    stage,
    kind,
    responseSec: stage === "answered" ? responseSec : null,
  });
}

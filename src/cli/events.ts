import { isNagStage, logDiscordNag, NAG_STAGES } from "../hooks/lib/discord-events";
import { collectEvents } from "../tools/lib/collectors";
import { group, leaf, UsageError } from "../tools/lib/command";

function secondsFrom(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new UsageError(`--after-sec must be a number of seconds, got "${raw}"`);
  }
  return Math.round(seconds);
}

function recordDiscordNag(
  stage: string | undefined,
  kind: string | undefined,
  afterSec: string | undefined
): undefined {
  if (!isNagStage(stage)) {
    throw new UsageError(`the stage is one of ${NAG_STAGES.join(", ")}`);
  }
  const responseSec = secondsFrom(afterSec);
  if (stage === "answered" && responseSec === null) {
    throw new UsageError("an answered nag needs --after-sec");
  }
  const id = logDiscordNag(stage, kind ?? null, responseSec);
  console.log(id ? `Recorded ${id}` : "The event log is off; nothing recorded.");
}

function reportCollected(): undefined {
  const emitted = collectEvents();
  const sources = Object.entries(emitted);
  if (sources.length === 0) {
    console.log("The event log is off; nothing collected.");
    return;
  }
  for (const [source, count] of sources) console.log(`${source}: ${count}`);
}

export const eventsCommand = group({
  summary: "PAL's local event log",
  commands: {
    collect: leaf({
      summary: "Read every agent's own records into the event log",
      run: () => reportCollected(),
    }),
    "discord-nag": leaf({
      summary: "Record a nag the Discord bot sent, or how long its answer took",
      args: "<sent|answered>",
      options: {
        kind: { type: "string", value: "<kind>", description: "What the nag was about" },
        "after-sec": {
          type: "string",
          value: "<n>",
          description: "Seconds from the nag to the answer",
        },
      },
      run: ({ positionals, values }) =>
        recordDiscordNag(positionals[0], values.kind, values["after-sec"]),
    }),
  },
});

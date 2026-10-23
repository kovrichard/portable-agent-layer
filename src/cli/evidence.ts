import {
  contentFor,
  type EvidenceTurn,
  forget,
  userTurnsSince,
} from "../hooks/lib/evidence";
import { group, leaf, UsageError } from "../tools/lib/command";
import { windowDays } from "./correction";

const DAY_MS = 86_400_000;
const JSON_OPTION = { type: "boolean", description: "Machine-readable output" } as const;

function oneLine(text: string | null): string {
  return (text ?? "(no text)").replace(/\s+/g, " ").slice(0, 100);
}

function printTurns(turns: EvidenceTurn[], json: boolean): undefined {
  if (json) {
    console.log(JSON.stringify(turns, null, 2));
    return;
  }
  for (const turn of turns) console.log(`${turn.ts}  ${turn.id}  ${oneLine(turn.text)}`);
  console.log(`${turns.length} turns`);
}

function requiredId(id: string | undefined): string {
  if (!id) throw new UsageError("give the event id");
  return id;
}

function printContent(id: string | undefined): undefined {
  const row = contentFor(requiredId(id));
  if (!row) throw new UsageError(`no stored text for ${id}`);
  console.log(JSON.stringify(row, null, 2));
}

function printForgotten(id: string | undefined): undefined {
  const target = requiredId(id);
  if (!forget(target)) throw new UsageError(`no stored text for ${target}`);
  console.log(`Forgot ${target}`);
}

export const evidenceCommand = group({
  summary: "What PAL learns from: the turns the user typed, with their text",
  commands: {
    turns: leaf({
      summary: "The user's turns in a window, each with its text and reply",
      options: {
        days: { type: "string", description: "Window in days (default 30)" },
        json: JSON_OPTION,
      },
      run: ({ values }) =>
        printTurns(
          userTurnsSince(new Date(Date.now() - windowDays(values.days) * DAY_MS)),
          values.json === true
        ),
    }),
    show: leaf({
      summary: "The stored text of one event",
      args: "<id>",
      run: ({ positionals }) => printContent(positionals[0]),
    }),
    forget: leaf({
      summary: "Remove one event's text and keep it out of everything PAL learns",
      args: "<id>",
      run: ({ positionals }) => printForgotten(positionals[0]),
    }),
  },
});

import {
  contentFor,
  type EvidenceTurn,
  exclusions,
  forget,
  unforget,
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

function printContent(id: string): undefined {
  const row = contentFor(id);
  if (!row) throw new UsageError(`no stored text for ${id}`);
  console.log(JSON.stringify(row, null, 2));
}

function printForgotten(id: string): undefined {
  if (!forget(id)) throw new UsageError(`no stored text for ${id}`);
  console.log(
    `Forgot ${id}; its text is kept, undo with: pal cli evidence unforget ${id}`
  );
}

function printUnforgotten(id: string): undefined {
  if (!unforget(id)) throw new UsageError(`${id} is not forgotten`);
  console.log(`${id} counts as evidence again`);
}

function printExclusions(): undefined {
  const excluded = exclusions();
  for (const { id, since } of excluded) {
    const row = contentFor(id);
    console.log(`${since}  ${id}  ${oneLine(textOf(row))}`);
  }
  console.log(`${excluded.length} forgotten`);
}

const textOf = (row: ReturnType<typeof contentFor>): string | null => {
  const text = row?.prompt ?? row?.reply;
  return typeof text === "string" ? text : null;
};

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
      run: ({ positionals }) => printContent(positionals[0] as string),
    }),
    forget: leaf({
      summary: "Keep one event out of everything PAL learns; its text is kept",
      args: "<id>",
      run: ({ positionals }) => printForgotten(positionals[0] as string),
    }),
    unforget: leaf({
      summary: "Count a forgotten event as evidence again",
      args: "<id>",
      run: ({ positionals }) => printUnforgotten(positionals[0] as string),
    }),
    forgotten: leaf({
      summary: "Every forgotten event, when it was forgotten, and its text",
      run: () => printExclusions(),
    }),
  },
});

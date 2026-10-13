import { leaf, UsageError } from "../tools/lib/command";
import { wrappedAgents } from "../tools/lib/wrapped/agents";
import { wrappedHabits } from "../tools/lib/wrapped/habits";
import { wrappedRecords } from "../tools/lib/wrapped/records";
import {
  agentsLines,
  habitsLines,
  recordsLines,
  totalsLines,
} from "../tools/lib/wrapped/render";
import { wrappedTotals } from "../tools/lib/wrapped/totals";
import { eventsOfYear } from "../tools/lib/wrapped/year";

function yearFrom(value: string | undefined): number {
  if (value === undefined) return new Date().getFullYear();
  if (!/^\d{4}$/.test(value)) throw new UsageError(`--year takes a year, got: ${value}`);
  return Number(value);
}

function printWrapped(year: number): undefined {
  const events = eventsOfYear(year);
  console.log(`\n  PAL Wrapped ${year}`);
  if (events.length === 0) {
    console.log(`\n  No events logged in ${year}\n`);
    return;
  }
  const lines = [
    ...totalsLines(wrappedTotals(events)),
    ...recordsLines(wrappedRecords(events)),
    ...habitsLines(wrappedHabits(events)),
    ...agentsLines(wrappedAgents(events)),
  ];
  for (const line of lines) console.log(line);
}

export const wrappedCommand = leaf({
  summary: "A year of your work in numbers, read from the event log",
  options: {
    year: {
      type: "string",
      value: "<yyyy>",
      description: "Which year (default: this one)",
    },
  },
  run: ({ values }) => printWrapped(yearFrom(values.year)),
});

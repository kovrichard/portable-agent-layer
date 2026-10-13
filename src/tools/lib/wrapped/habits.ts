import type { LoggedEvent } from "../../../hooks/lib/events";
import { localClock } from "../../../hooks/lib/wall-clock";
import type { Best } from "./records";
import { dayOf, isUserActivity, ofType, type Tally, tally } from "./year";

export interface WrappedHabits {
  mostActiveHour: Best | null;
  mostActiveWeekday: Best | null;
  mostActiveMonth: Best | null;
  nightShare: number | null;
  weekendShare: number | null;
  channels: Tally[];
  skimRate: number | null;
  correctionRate: number | null;
}

interface HourSlot {
  day: string;
  hour: number;
  weekday: string;
}

const NIGHT_FROM = 22;
const NIGHT_UNTIL = 6;
const WEEKEND = new Set(["Sat", "Sun"]);

/** One slot per local hour with any of the user's own activity, however busy it was. */
function activeSlots(events: LoggedEvent[]): HourSlot[] {
  const slots = new Map<string, HourSlot>();
  for (const e of events.filter(isUserActivity)) {
    const day = dayOf(e);
    const clock = localClock(new Date(e.ts));
    slots.set(`${day} ${clock.hour}`, { day, ...clock });
  }
  return [...slots.values()];
}

function shareOf<T>(items: T[], matches: (item: T) => boolean): number | null {
  return items.length === 0 ? null : items.filter(matches).length / items.length;
}

/** Ties go to the first label, which for hours and months is the earliest. */
function busiest(slots: HourSlot[], labelOf: (slot: HourSlot) => string): Best | null {
  const [top] = tally(slots, labelOf);
  return top ? { value: top.count, label: top.name } : null;
}

const hourOf = ({ hour }: HourSlot) => `${String(hour).padStart(2, "0")}:00`;

const isNight = ({ hour }: HourSlot) => hour >= NIGHT_FROM || hour < NIGHT_UNTIL;

export const channelOf = (turn: LoggedEvent) =>
  typeof turn.channel === "string" ? turn.channel : "terminal";

/** Skimming is only measured on a turn that answered a reply. */
export function wrappedHabits(events: LoggedEvent[]): WrappedHabits {
  const slots = activeSlots(events);
  const turns = ofType(events, "turn");
  return {
    mostActiveHour: busiest(slots, hourOf),
    mostActiveWeekday: busiest(slots, (s) => s.weekday),
    mostActiveMonth: busiest(slots, (s) => s.day.slice(0, 7)),
    nightShare: shareOf(slots, isNight),
    weekendShare: shareOf(slots, (s) => WEEKEND.has(s.weekday)),
    channels: tally(turns, channelOf),
    skimRate: shareOf(
      turns.filter((t) => t.reply !== null && t.reply !== undefined),
      (t) => t.skimmed === true
    ),
    correctionRate: shareOf(turns, (t) => t.corrected === true),
  };
}

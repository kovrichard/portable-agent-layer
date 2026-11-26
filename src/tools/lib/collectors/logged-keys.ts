import { existsSync } from "node:fs";
import { type EventType, eventMonthFile } from "../../../bronze/events";
import { transcriptLines } from "../../../bronze/transcript-lines";

type KeyOf = (event: Record<string, unknown>) => string;

/**
 * Tells whether an event with the same key is already in its month's log, loading
 * each month once. A collector reads each transcript from its own cursor, so a copy
 * of a transcript (a forked session, a subagent file in another session's folder)
 * would otherwise log the same records again.
 */
export function alreadyLoggedCheck(
  type: EventType,
  keyOf: KeyOf
): (event: Record<string, unknown> & { ts: string }) => Promise<boolean> {
  const months = new Map<string, Set<string>>();
  const monthKeys = async (ts: string) => {
    const month = ts.slice(0, 7);
    const known =
      months.get(month) ?? (await keysIn(eventMonthFile(new Date(ts)), type, keyOf));
    months.set(month, known);

    return known;
  };

  return async (event) => {
    const known = await monthKeys(event.ts);
    const key = keyOf(event);
    if (known.has(key)) return true;
    known.add(key);

    return false;
  };
}

function parsedEvent(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function keysIn(
  monthFile: string,
  type: EventType,
  keyOf: KeyOf
): Promise<Set<string>> {
  const keys = new Set<string>();

  if (!existsSync(monthFile)) return keys;

  for await (const { text } of transcriptLines(monthFile)) {
    if (!text.includes(`"type":"${type}"`)) continue;
    const event = parsedEvent(text);
    if (event) keys.add(keyOf(event));
  }

  return keys;
}

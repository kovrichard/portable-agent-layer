import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EventType, LoggedEvent } from "../../src/hooks/lib/events";
import { reload } from "../../src/hooks/lib/settings";
import { freshTestDir } from "./test-home";

export function budapestHome(testFile: string): string {
  const home = freshTestDir(testFile);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory"), { recursive: true });
  writeFileSync(
    resolve(home, "memory", "pal-settings.json"),
    JSON.stringify({ identity: { principal: { timezone: "Europe/Budapest" } } })
  );
  reload();
  return home;
}

let seq = 0;

export function event(
  type: EventType,
  fields: Record<string, unknown> = {},
  envelope: Partial<LoggedEvent> = {}
): LoggedEvent {
  seq++;
  return {
    v: 1,
    id: `e${seq}`,
    ts: "2026-06-01T10:00:00.000Z",
    type,
    session: null,
    runtime: "claude",
    machine: "m",
    actor: "a",
    authority: "self",
    channel: null,
    project: null,
    cwd: "/w",
    ...envelope,
    ...fields,
  };
}

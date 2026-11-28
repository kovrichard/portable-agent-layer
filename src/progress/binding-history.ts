/**
 * bindings.json as silver over bronze: every binding change is a project event
 * stamped with its machine, so this machine's file can be rebuilt by replaying
 * its own events, and any write that bypassed them shows up as drift.
 */

import { eventsSince, type LoggedEvent } from "../bronze/events";
import { contentById } from "../bronze/evidence";
import { loadMachine } from "../core/machine";
import { palHome } from "../core/paths";
import { type Bindings, readBindings } from "../core/project-bindings";
import {
  type BindingChange,
  bindingChanges,
  logBindingChanges,
  writeBindings,
} from "./bindings";

function bindingEventsOfThisMachine(home: string): LoggedEvent[] {
  const machine = loadMachine(home).id;

  return eventsSince("project", new Date(0)).filter(
    (e) =>
      e.machine === machine &&
      typeof e.project === "string" &&
      (e.change === "bound" || e.change === "unbound")
  );
}

export function hasBindingHistory(home: string = palHome()): boolean {
  return bindingEventsOfThisMachine(home).length > 0;
}

/** The bindings this machine's events leave behind, oldest event first. */
export function replayedBindings(home: string = palHome()): Bindings {
  const text = contentById();
  const bindings: Bindings = {};

  for (const event of bindingEventsOfThisMachine(home)) {
    const project = event.project as string;
    const path = text.get(event.id)?.path;

    if (event.change === "unbound") delete bindings[project];
    else if (typeof path === "string") bindings[project] = path;
  }

  return bindings;
}

/** What bindings.json holds that its history does not explain, as changes from the history to the file. */
export function bindingDrift(home: string = palHome()): BindingChange[] {
  return bindingChanges(replayedBindings(home), readBindings(home));
}

/** The file wins: its differences from the history are logged as changes, and the file stays as it is. */
export function adoptBindingsFile(home: string = palHome()): BindingChange[] {
  const drift = bindingDrift(home);
  logBindingChanges(drift);

  return drift;
}

/** The history wins: the file is rewritten from the replay, which logs what it undid. */
export function rebuildBindingsFile(home: string = palHome()): BindingChange[] {
  const replay = replayedBindings(home);
  const undone = bindingChanges(readBindings(home), replay);
  writeBindings(replay, home);

  return undone;
}

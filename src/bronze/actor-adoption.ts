/**
 * One person is one actor on every install. When another install's actor.json
 * replaces this one's, the replaced id stays in the registry as an alias of the
 * adopted one, so records it signed still name the same person, and bronze
 * keeps an `actor_adopted` event of the switch.
 */

import { ensureActorRegistered, storedActor, writeActorEntry } from "../core/actor";
import { palHome } from "../core/paths";
import { appendEvent } from "./events";

/** Record that the actor in `replacedRaw` gave way to the one now on disk. */
export function recordAdoptedActor(replacedRaw: string, home: string = palHome()): void {
  const replaced = storedActor(replacedRaw);
  const current = ensureActorRegistered(home);
  if (!replaced || replaced.id === current.id) return;

  writeActorEntry({ id: replaced.id, label: replaced.label, aliasOf: current.id });
  appendEvent("actor_adopted", { from: replaced.id, to: current.id });
}

/**
 * pal cli actor / pal cli machine — read and rename the two identities PAL keeps.
 *
 *   pal cli actor                 Show this actor's label and id
 *   pal cli actor label <name>    Rename the actor — who caused a record
 *   pal cli machine               Show this install's label and id
 *   pal cli machine label <name>  Rename the machine — where a record was written
 *
 * Renaming touches no stored record: both subjects resolve a label on read, so
 * an id already written into a thread or a reflection reads under the new name
 * immediately. The registry entry is refreshed here so the change also travels
 * on the next export.
 */

import {
  actorFilePath,
  ensureActorRegistered,
  loadActor,
  setActorLabel,
} from "../hooks/lib/actor";
import { shortId } from "../hooks/lib/identity-store";
import {
  ensureRegistered,
  loadMachine,
  machineFilePath,
  setLabel,
} from "../hooks/lib/machine";
import { log } from "../targets/lib";

export type IdentitySubject = "actor" | "machine";

interface SubjectOps {
  /** What the id names, for the one-line description. */
  noun: string;
  read(): { id: string; label: string };
  rename(name: string): { id: string; label: string };
  register(): void;
  file(): string;
}

const SUBJECTS: Record<IdentitySubject, SubjectOps> = {
  actor: {
    noun: "who caused a record",
    read: () => loadActor(),
    rename: (name) => setActorLabel(name),
    register: () => {
      ensureActorRegistered();
    },
    file: () => actorFilePath(),
  },
  machine: {
    noun: "where a record was written",
    read: () => loadMachine(),
    rename: (name) => {
      const updated = setLabel(name);
      return updated;
    },
    register: () => {
      ensureRegistered();
    },
    file: () => machineFilePath(),
  },
};

function show(subject: IdentitySubject): number {
  const ops = SUBJECTS[subject];
  const { id, label } = ops.read();
  console.log(`${subject}: ${label} (${shortId(id)}) — ${ops.noun}`);
  console.log(`  id:   ${id}`);
  console.log(`  file: ${ops.file()}`);
  return 0;
}

function rename(subject: IdentitySubject, name: string): number {
  const ops = SUBJECTS[subject];
  const before = ops.read();
  const after = ops.rename(name);
  ops.register();
  if (after.label === before.label) {
    log.info(`${subject} is already named ${after.label}`);
    return 0;
  }
  log.success(`${subject} renamed: ${before.label} → ${after.label}`);
  return 0;
}

export function runIdentity(subject: IdentitySubject, args: string[]): number {
  const [action, ...rest] = args;

  if (!action) return show(subject);

  if (action === "label") {
    const name = rest.join(" ").trim();
    if (!name) {
      log.error(`Usage: pal cli ${subject} label <name>`);
      return 1;
    }
    return rename(subject, name);
  }

  log.error(`Unknown ${subject} action: ${action}`);
  log.info(`Usage: pal cli ${subject} [label <name>]`);
  return 1;
}

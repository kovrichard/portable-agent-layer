/**
 * pal cli actor / pal cli machine — read and rename the two identities PAL keeps.
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
import { type Group, group, leaf, runCommand, UsageError } from "../tools/lib/command";

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

function renameTo(subject: IdentitySubject, words: string[]): number {
  const name = words.join(" ").trim();
  if (!name) throw new UsageError("the name is empty");
  return rename(subject, name);
}

export function identityCommand(subject: IdentitySubject): Group {
  const { noun } = SUBJECTS[subject];
  return group({
    summary: `Show or rename this ${subject} — ${noun}`,
    fallback: "show",
    commands: {
      show: leaf({
        summary: `Show this ${subject}'s label and id`,
        run: () => show(subject),
      }),
      label: leaf({
        summary: `Rename the ${subject}; stored records read under the new name at once`,
        args: "<name...>",
        run: ({ positionals }) => renameTo(subject, positionals),
      }),
    },
  });
}

export function runIdentity(subject: IdentitySubject, args: string[]): Promise<number> {
  return runCommand(identityCommand(subject), args, ["pal", "cli", subject]);
}

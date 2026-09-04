/**
 * Actor identity — who caused a record, as distinct from where it was written.
 *
 * A machine id answers "which install"; it deliberately never crosses an export
 * boundary, because two installs sharing one id breaks every origin-scoped
 * read. An actor id answers "which person", and needs the opposite treatment:
 * the same person on a laptop and a desktop is one actor, so `actor.json` lives
 * under memory/ where the export picks it up and the import merge adopts it on
 * an install that has none. An install that already has an actor keeps it — the
 * merge treats a diverged file as a conflict and leaves the local side in place.
 *
 * Identity alone does not attribute an action. `currentAttribution()` is the
 * stamp a record carries: the person, the install, the agent runtime they were
 * driving, and whether a human turn was behind the call at all.
 */

import { resolve } from "node:path";
import { type AgentType, getActiveAgent } from "./agent";
import {
  type IdentityBase,
  loadIdentity,
  readRegistryEntries,
  relabelIdentity,
  resolveDisplayName,
  shortId,
  writeRegistryEntry as writeEntry,
} from "./identity-store";
import { loadMachine } from "./machine";
import { palHome, paths } from "./paths";
import { identity } from "./settings";
import { isPalSpawnedInference } from "./spawn-guard";

export type ActorIdentity = IdentityBase;

/**
 * Under what authority an action ran. `user` means a human turn drove it;
 * `agent` means PAL spawned the inference itself and no human saw the call.
 * This is the authority PAL can observe today — an approval a PAL-owned gate
 * granted is a further distinction that gate has to introduce.
 */
export type Authority = "user" | "agent";

/** The origin fields every attributable record carries. */
export interface RecordAttribution {
  /** Machine id — which install wrote it. */
  m: string;
  /** Actor id — which person caused it. */
  a: string;
  /** Agent runtime the actor was driving. */
  rt: AgentType;
  /** Whether a human turn was behind the call. */
  au: Authority;
}

/**
 * Unlike machine.json this sits inside memory/, so it is exported and can be
 * adopted by a second install belonging to the same person.
 */
export function actorFilePath(home: string = palHome()): string {
  return resolve(home, "memory", "actor.json");
}

function actorsDir(): string {
  return resolve(paths.memory(), "actors");
}

/**
 * Neutral default label, on the same reasoning as the machine default: the
 * label travels in every exported registry entry, so a real name belongs there
 * only once its owner has chosen to put it there.
 */
export function defaultActorLabel(id: string): string {
  return `actor-${shortId(id)}`;
}

function newActor(): ActorIdentity {
  const id = crypto.randomUUID();
  return { id, label: defaultActorLabel(id), createdAt: new Date().toISOString() };
}

function repairActor(stored: Partial<ActorIdentity> & { id: string }): ActorIdentity {
  return {
    id: stored.id,
    label: stored.label?.trim() || defaultActorLabel(stored.id),
    createdAt: stored.createdAt || new Date().toISOString(),
  };
}

/**
 * This person's identity, minted on first call and stable afterwards — across
 * machines, once an export has carried it there.
 */
export function loadActor(home: string = palHome()): ActorIdentity {
  return loadIdentity(actorFilePath(home), newActor, repairActor);
}

/** Rename this actor. No stored record is touched — labels resolve on read. */
export function setActorLabel(label: string, home: string = palHome()): ActorIdentity {
  return relabelIdentity(actorFilePath(home), loadActor(home), label);
}

export interface ActorRegistryEntry {
  id: string;
  label: string;
}

/** Write (or refresh) an actor's registry entry. Registry entries are exported. */
export function writeActorEntry(entry: ActorRegistryEntry, body = ""): string {
  return writeEntry(actorsDir(), { ...entry }, body);
}

/** Every known actor, this one and any that arrived via import. */
export function readActorRegistry(): ActorRegistryEntry[] {
  return readRegistryEntries(actorsDir()).map((meta) => ({
    id: meta.id,
    label: meta.label,
  }));
}

/** Name for a record's actor, falling back to the short id. */
export function actorDisplayName(id: string, registry: ActorRegistryEntry[]): string {
  return resolveDisplayName(id, registry);
}

/** Register this actor so their label resolves on anyone else's install. */
export function ensureActorRegistered(home: string = palHome()): ActorIdentity {
  const actor = loadActor(home);
  writeActorEntry({ id: actor.id, label: actor.label });
  return actor;
}

/**
 * Adopt the principal's name as the actor label, but only while the label is
 * still the generated default — a chosen label is never overwritten. Runs at
 * install rather than at mint, so an actor created before the name was known
 * still picks it up. The settings default of "User" names nobody, so it is not
 * adopted.
 */
export function seedActorLabel(home: string = palHome()): ActorIdentity {
  const actor = loadActor(home);
  if (actor.label !== defaultActorLabel(actor.id)) return actor;
  const name = identity().principal.name.trim();
  if (!name || name === "User") return actor;
  return setActorLabel(name, home);
}

/** Authority behind the call currently executing. */
export function currentAuthority(): Authority {
  return isPalSpawnedInference() ? "agent" : "user";
}

/**
 * The origin stamp for a record written right now. Every attributable writer
 * spreads this instead of stamping a machine id alone.
 */
export function currentAttribution(): RecordAttribution {
  return {
    m: loadMachine().id,
    a: loadActor().id,
    rt: getActiveAgent(),
    au: currentAuthority(),
  };
}

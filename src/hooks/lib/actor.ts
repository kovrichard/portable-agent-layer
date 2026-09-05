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
import { type AgentType, declaredAgent } from "./agent";
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

/**
 * The origin fields every attributable record carries. Spelled out rather than
 * abbreviated: these rows are meant to be read by whoever is auditing them, and
 * a key nobody can decode is the same as no key at all.
 */
export interface RecordAttribution {
  /** Which install wrote it. */
  machine: string;
  /** Which person caused it. */
  actor: string;
  /** Which agent the actor was driving, or "unknown" when none declared itself. */
  runtime: AgentType | "unknown";
  /** Whether a human turn was behind the call. */
  authority: Authority;
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
 * The name the principal already told PAL, or nothing. The settings default of
 * "User" names nobody, so it never becomes a label.
 */
function principalName(): string {
  const name = identity().principal.name.trim();
  return !name || name === "User" ? "" : name;
}

/**
 * This person's identity, minted on first call and stable afterwards — across
 * machines, once an export has carried it there.
 *
 * The label is derived, not stored-at-mint: while it is still the generated
 * default, the principal's configured name wins. Seeding it once at install
 * only held for installs that ran the seeding step, so an actor minted by an
 * upgrade kept a neutral label forever while settings knew the name all along.
 * Deriving on read makes the name hold on every install without a step anyone
 * has to remember. A label the user chose is stored, and is never overridden.
 */
export function loadActor(home: string = palHome()): ActorIdentity {
  const actor = loadIdentity(actorFilePath(home), newActor, repairActor);
  if (actor.label !== defaultActorLabel(actor.id)) return actor;
  const name = principalName();
  return name ? { ...actor, label: name } : actor;
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
    machine: loadMachine().id,
    actor: loadActor().id,
    runtime: declaredAgent() ?? "unknown",
    authority: currentAuthority(),
  };
}

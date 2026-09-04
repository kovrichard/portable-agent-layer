/**
 * Machine identity — which install a record came from.
 *
 * `machine.json` lives at the PAL_HOME root, outside every exported directory,
 * because importing it would give two installs one id and silently break every
 * origin-scoped read built on top of it. Contrast with actor.ts, whose file
 * lives under memory/ precisely so it does travel: one person on two machines
 * is one actor, but never one machine.
 *
 * The storage mechanics live in identity-store.ts; this module supplies the
 * machine-specific parts — where the file lives, the `os` field, and a label
 * that is deliberately not the hostname.
 */

import { platform as osPlatform } from "node:os";
import { resolve } from "node:path";
import {
  type IdentityBase,
  loadIdentity,
  readRegistryEntries,
  relabelIdentity,
  resolveDisplayName,
  shortId,
  writeRegistryEntry as writeEntry,
} from "./identity-store";
import { palHome, paths } from "./paths";

export interface MachineIdentity extends IdentityBase {
  os: string;
}

export { shortId };

export function machineFilePath(home: string = palHome()): string {
  return resolve(home, "machine.json");
}

function machinesDir(): string {
  return resolve(paths.memory(), "machines");
}

/**
 * Neutral default label. Deliberately not derived from the hostname: a hostname
 * routinely carries the owner's real name, and the label travels in every
 * exported registry entry.
 */
export function defaultLabel(id: string): string {
  return `machine-${shortId(id)}`;
}

function newIdentity(): MachineIdentity {
  const id = crypto.randomUUID();
  return {
    id,
    label: defaultLabel(id),
    os: osPlatform(),
    createdAt: new Date().toISOString(),
  };
}

function repair(stored: Partial<MachineIdentity> & { id: string }): MachineIdentity {
  return {
    id: stored.id,
    label: stored.label?.trim() || defaultLabel(stored.id),
    os: stored.os || osPlatform(),
    createdAt: stored.createdAt || new Date().toISOString(),
  };
}

/**
 * This install's identity, created on first call and stable afterwards. The id
 * is never regenerated once the file exists — a changed id orphans every record
 * that referenced the old one.
 */
export function loadMachine(home: string = palHome()): MachineIdentity {
  return loadIdentity(machineFilePath(home), newIdentity, repair);
}

/** Rename this machine. No stored record is touched — labels resolve on read. */
export function setLabel(label: string, home: string = palHome()): MachineIdentity {
  return relabelIdentity(machineFilePath(home), loadMachine(home), label);
}

export interface RegistryEntry {
  id: string;
  label: string;
  os: string;
}

/** Write (or refresh) a machine's registry entry. Registry entries are exported. */
export function writeRegistryEntry(entry: RegistryEntry, body = ""): string {
  return writeEntry(machinesDir(), { ...entry }, body);
}

/** Every known machine, this one and any that arrived via import. */
export function readRegistry(): RegistryEntry[] {
  return readRegistryEntries(machinesDir()).map((meta) => ({
    id: meta.id,
    label: meta.label,
    os: meta.os ?? "",
  }));
}

/** Name for a record's origin machine, falling back to the short id. */
export function displayName(id: string, registry: RegistryEntry[]): string {
  return resolveDisplayName(id, registry);
}

/** Register this install so its label can be resolved on any machine. */
export function ensureRegistered(home: string = palHome()): MachineIdentity {
  const identity = loadMachine(home);
  writeRegistryEntry({ id: identity.id, label: identity.label, os: identity.os });
  return identity;
}

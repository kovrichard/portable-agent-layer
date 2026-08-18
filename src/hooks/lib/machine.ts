/**
 * Machine identity — who this install is, and how a record's origin becomes a
 * name at display time.
 *
 * Records store the id and never the label. Resolution happens on read, so
 * renaming a machine is a one-file edit that no stored record notices, and two
 * machines sharing a label is a display concern rather than a data collision.
 *
 * `machine.json` lives at the PAL_HOME root, outside every exported directory,
 * because importing it would give two installs one id and silently break every
 * origin-scoped read built on top of it.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { platform as osPlatform } from "node:os";
import { resolve } from "node:path";
import { parse, stringify } from "./frontmatter";
import { palHome, paths } from "./paths";

export interface MachineIdentity {
  id: string;
  label: string;
  os: string;
  createdAt: string;
}

const SHORT_ID_LENGTH = 4;

export function machineFilePath(home: string = palHome()): string {
  return resolve(home, "machine.json");
}

function machinesDir(): string {
  const dir = resolve(paths.memory(), "machines");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** First segment of the uuid — enough to disambiguate two same-labelled machines. */
export function shortId(id: string): string {
  return id.replaceAll("-", "").slice(0, SHORT_ID_LENGTH);
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

function hasUsableId(value: unknown): value is Partial<MachineIdentity> & { id: string } {
  const v = value as Partial<MachineIdentity> | null;
  return typeof v?.id === "string" && v.id.length > 0;
}

/**
 * Fill in whatever a stored identity is missing. Only the id is irreplaceable —
 * discarding one orphans every record that referenced it — so a file carrying a
 * usable id is repaired rather than regenerated.
 */
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
  const file = machineFilePath(home);
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
      if (hasUsableId(parsed)) return repair(parsed);
    } catch {
      /* fall through to regeneration below */
    }
  }
  const identity = newIdentity();
  mkdirSync(home, { recursive: true });
  writeFileSync(file, `${JSON.stringify(identity, null, 2)}\n`);
  return identity;
}

/** Rename this machine. No stored record is touched — labels resolve on read. */
export function setLabel(label: string, home: string = palHome()): MachineIdentity {
  const current = loadMachine(home);
  const updated = { ...current, label: label.trim() || current.label };
  writeFileSync(machineFilePath(home), `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

export interface RegistryEntry {
  id: string;
  label: string;
  os: string;
}

function registryPath(id: string): string {
  return resolve(machinesDir(), `${id}.md`);
}

/** Write (or refresh) a machine's registry entry. Registry entries are exported. */
export function writeRegistryEntry(entry: RegistryEntry, body = ""): string {
  const file = registryPath(entry.id);
  const existingBody = existsSync(file) ? parse(readFileSync(file, "utf-8")).body : "";
  const content = stringify(
    {
      id: entry.id,
      label: entry.label,
      os: entry.os,
      updated: new Date().toISOString(),
    },
    body || existingBody
  );
  writeFileSync(file, content);
  return file;
}

/** Every known machine, this one and any that arrived via import. */
export function readRegistry(): RegistryEntry[] {
  const dir = machinesDir();
  const entries: RegistryEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    try {
      const meta = parse<Record<string, string>>(
        readFileSync(resolve(dir, name), "utf-8")
      ).meta;
      if (meta.id && meta.label) {
        entries.push({ id: meta.id, label: meta.label, os: meta.os ?? "" });
      }
    } catch {
      /* a malformed entry must not hide the rest of the registry */
    }
  }
  return entries;
}

/**
 * Name for a record's origin id. Unknown ids fall back to the short id so a
 * record from a machine whose entry has not arrived yet still reads sensibly.
 * A label shared by two machines is suffixed rather than deduplicated — the
 * registry is not always reachable, so uniqueness can never be enforced.
 */
export function displayName(id: string, registry: RegistryEntry[]): string {
  const entry = registry.find((e) => e.id === id);
  if (!entry) return shortId(id);
  const sharesLabel = registry.some((e) => e.id !== id && e.label === entry.label);
  return sharesLabel ? `${entry.label}·${shortId(id)}` : entry.label;
}

/** Register this install so its label can be resolved on any machine. */
export function ensureRegistered(home: string = palHome()): MachineIdentity {
  const identity = loadMachine(home);
  writeRegistryEntry({ id: identity.id, label: identity.label, os: identity.os });
  return identity;
}

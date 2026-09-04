/**
 * Identity store — the mechanics shared by every kind of identity PAL keeps.
 *
 * PAL names two different subjects. A machine is the install a record came
 * from; an actor is the person who caused it. They answer different questions
 * and travel in opposite directions across an export boundary, but the storage
 * problem is identical: a uuid that must never be regenerated, a label that
 * resolves on read so a rename touches no stored record, and a registry of
 * `<id>.md` entries so an id written on one install still reads as a name on
 * another.
 *
 * Each subject supplies its own file location, its own extra fields, and its
 * own default label. Everything below is the part that does not differ.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse, stringify } from "./frontmatter";

export interface IdentityBase {
  id: string;
  label: string;
  createdAt: string;
}

/** Frontmatter of one registry entry. Every value is a string on disk. */
export type RegistryFields = Record<string, string> & { id: string; label: string };

/** Anything the display resolver can name. Extra fields are ignored. */
export interface NameableEntry {
  id: string;
  label: string;
}

const SHORT_ID_LENGTH = 4;

/** First segment of the uuid — enough to disambiguate two same-labelled subjects. */
export function shortId(id: string): string {
  return id.replaceAll("-", "").slice(0, SHORT_ID_LENGTH);
}

function hasUsableId(value: unknown): value is { id: string } {
  const v = value as { id?: unknown } | null;
  return typeof v?.id === "string" && v.id.length > 0;
}

/** Persist a record, creating its directory if this is the first write. */
function saveIdentity<T extends IdentityBase>(file: string, record: T): T {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/**
 * Read a stored identity, or mint one on first call.
 *
 * The id is the only irreplaceable field — discarding one orphans every record
 * that referenced it — so a file carrying a usable id is repaired rather than
 * regenerated, and a file that has lost its id is treated as absent.
 */
export function loadIdentity<T extends IdentityBase>(
  file: string,
  create: () => T,
  repair: (stored: Partial<T> & { id: string }) => T
): T {
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
      if (hasUsableId(parsed)) return repair(parsed as Partial<T> & { id: string });
    } catch {
      /* fall through to minting a fresh identity below */
    }
  }
  return saveIdentity(file, create());
}

/** Change a label without touching any stored record — labels resolve on read. */
export function relabelIdentity<T extends IdentityBase>(
  file: string,
  current: T,
  label: string
): T {
  return saveIdentity(file, { ...current, label: label.trim() || current.label });
}

function entryPath(dir: string, id: string): string {
  return resolve(dir, `${id}.md`);
}

/** Write (or refresh) a registry entry. Registry entries are exported. */
export function writeRegistryEntry(
  dir: string,
  fields: RegistryFields,
  body = ""
): string {
  mkdirSync(dir, { recursive: true });
  const file = entryPath(dir, fields.id);
  const existingBody = existsSync(file) ? parse(readFileSync(file, "utf-8")).body : "";
  writeFileSync(
    file,
    stringify({ ...fields, updated: new Date().toISOString() }, body || existingBody)
  );
  return file;
}

/**
 * Every entry in a registry directory. Only `.md` files count, and an entry
 * missing an id or a label is dropped — a malformed one must not hide the rest.
 */
export function readRegistryEntries(dir: string): RegistryFields[] {
  mkdirSync(dir, { recursive: true });
  const entries: RegistryFields[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    try {
      const { meta } = parse<Record<string, string>>(
        readFileSync(resolve(dir, name), "utf-8")
      );
      if (meta.id && meta.label) entries.push(meta as RegistryFields);
    } catch {
      /* a malformed entry must not hide the rest of the registry */
    }
  }
  return entries;
}

/**
 * Name for a record's id. Unknown ids fall back to the short id so a record
 * whose registry entry has not arrived yet still reads sensibly. A label shared
 * by two subjects is suffixed rather than deduplicated — the registry is not
 * always reachable, so uniqueness can never be enforced.
 */
export function resolveDisplayName(id: string, registry: NameableEntry[]): string {
  const entry = registry.find((e) => e.id === id);
  if (!entry) return shortId(id);
  const sharesLabel = registry.some((e) => e.id !== id && e.label === entry.label);
  return sharesLabel ? `${entry.label}·${shortId(id)}` : entry.label;
}

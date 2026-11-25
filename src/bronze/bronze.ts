import { existsSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { ensureDir, palHome } from "../core/paths";

export type StoreGroup = "raw" | "bronze" | "outside";

export type StoreName =
  | "transcripts"
  | "events"
  | "event-text"
  | "tool-output"
  | "ledger"
  | "ratings"
  | "claim-checks"
  | "labelled-turns"
  | "rule-events"
  | "rule-candidates"
  | "run-estimates"
  | "reflections"
  | "progress-tree"
  | "sessions-archive"
  | "project-history"
  | "unbound-history"
  | "review-queue"
  | "import-log";

interface FormerFiles {
  match: RegExp;
  inProjectFolders?: true;
}

export interface RecordedStore {
  name: StoreName;
  group: StoreGroup;
  /** The store's folder, relative to the PAL home, with forward slashes. */
  location: string;
  /** Where the store lived before a layout move; read until the owner runs that move. */
  formerLocation?: string;
  /** The store's own files in a former folder it shared; absent, the whole folder was the store's. */
  formerFiles?: FormerFiles;
  files: string;
  appendOnly: boolean;
  alsoInEventLog: boolean;
}

const STORES: readonly RecordedStore[] = [
  {
    name: "transcripts",
    group: "raw",
    location: "records/raw/claude",
    formerLocation: "memory/content/claude",
    files: "<project>/**/<file>.gz",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "events",
    group: "bronze",
    location: "memory/events",
    files: "<YYYY-MM>.jsonl",
    appendOnly: true,
    alsoInEventLog: true,
  },
  {
    name: "event-text",
    group: "bronze",
    location: "memory/content/events",
    files: "<YYYY-MM>.jsonl",
    appendOnly: true,
    alsoInEventLog: true,
  },
  {
    name: "tool-output",
    group: "bronze",
    location: "memory/content/tool-output",
    files: "<YYYY-MM>.jsonl",
    appendOnly: true,
    alsoInEventLog: true,
  },
  {
    name: "ledger",
    group: "outside",
    location: "records/ledger",
    formerLocation: "memory/ledger",
    files: "actions.jsonl, rotated to actions-<stamp>.jsonl",
    appendOnly: true,
    alsoInEventLog: true,
  },
  {
    name: "ratings",
    group: "outside",
    location: "records/ratings",
    formerLocation: "memory/signals",
    formerFiles: { match: /^ratings\.jsonl$/ },
    files: "ratings.jsonl",
    appendOnly: true,
    alsoInEventLog: true,
  },
  {
    name: "claim-checks",
    group: "outside",
    location: "records/claim-checks",
    formerLocation: "memory/signals/claim-checks",
    files: "<YYYY-MM>.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "labelled-turns",
    group: "outside",
    location: "records/labelled-turns",
    formerLocation: "memory/adaptation",
    formerFiles: { match: /^turns-\d{4}-\d{2}\.jsonl$/ },
    files: "turns-<YYYY-MM>.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "rule-events",
    group: "outside",
    location: "records/rule-events",
    formerLocation: "memory/adaptation",
    formerFiles: { match: /^rule-events\.jsonl$/ },
    files: "rule-events.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "rule-candidates",
    group: "outside",
    location: "records/rule-candidates",
    formerLocation: "memory/adaptation",
    formerFiles: { match: /^candidates\.jsonl$/ },
    files: "candidates.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "run-estimates",
    group: "outside",
    location: "records/run-estimates",
    formerLocation: "memory/learning",
    formerFiles: { match: /^run-estimates\.jsonl$/ },
    files: "run-estimates.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "reflections",
    group: "outside",
    location: "records/reflections",
    formerLocation: "memory/learning/reflections",
    files: "algorithm-reflections.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "progress-tree",
    group: "outside",
    location: "memory/progress-tree",
    files: "events.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "sessions-archive",
    group: "outside",
    location: "records/sessions-archive",
    formerLocation: "memory/state/sessions-archive",
    files: "<YYYY-MM or undated>.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "project-history",
    group: "outside",
    location: "records/project-history",
    formerLocation: "memory/projects",
    formerFiles: { match: /^history\.jsonl$/, inProjectFolders: true },
    files: "<project>/history.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "unbound-history",
    group: "outside",
    location: "records/unbound-history",
    formerLocation: "memory/state/unbound-history",
    files: "<slug>.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "review-queue",
    group: "outside",
    location: "records/review-queue",
    formerLocation: "memory/knowledge",
    formerFiles: { match: /^_review\.jsonl$/ },
    files: "_review.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "import-log",
    group: "outside",
    location: "records/import-log",
    formerLocation: "memory/state",
    formerFiles: { match: /^import-log\.jsonl$/ },
    files: "import-log.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
];

function storesIn(group: StoreGroup): RecordedStore[] {
  return STORES.filter((store) => store.group === group);
}

export const rawStores = () => storesIn("raw");

export const bronzeStores = () => storesIn("bronze");

export const storesOutsideBronze = () => storesIn("outside");

export function storeNamed(name: string): RecordedStore {
  const store = STORES.find((candidate) => candidate.name === name);
  if (!store) throw new Error(`No recorded store is named "${name}"`);

  return store;
}

function at(home: string, location: string): string {
  return resolve(home, ...location.split("/"));
}

function filesNamedIn(dir: string, match: RegExp): string[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && match.test(entry.name))
    .map((entry) => entry.name);
}

function foldersIn(dir: string): string[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** The store's files left in a shared former folder, relative to it, with forward slashes. */
function formerFilesOf(store: RecordedStore, files: FormerFiles, home: string): string[] {
  const former = at(home, store.formerLocation as string);

  if (!files.inProjectFolders) return filesNamedIn(former, files.match);

  return foldersIn(former).flatMap((project) =>
    filesNamedIn(resolve(former, project), files.match).map(
      (name) => `${project}/${name}`
    )
  );
}

function formerHoldsStore(store: RecordedStore, home: string): boolean {
  if (!store.formerLocation) return false;

  if (!store.formerFiles) return existsSync(at(home, store.formerLocation));

  return formerFilesOf(store, store.formerFiles, home).length > 0;
}

/**
 * The store's folder under `home`. A store whose move the owner has not run yet
 * stays in its former folder; once the new folder exists it wins, so a late
 * write to the old path never sends the store back.
 */
export function storeLocation(name: StoreName, home: string = palHome()): string {
  const store = storeNamed(name);
  const current = at(home, store.location);
  if (existsSync(current) || !formerHoldsStore(store, home)) return current;

  return at(home, store.formerLocation as string);
}

export interface StoreMove {
  store: StoreName;
  from: string;
  to: string;
}

function movesOf(store: RecordedStore, home: string): StoreMove[] {
  const from = at(home, store.formerLocation as string);
  const to = at(home, store.location);

  if (!store.formerFiles) return [{ store: store.name, from, to }];

  return formerFilesOf(store, store.formerFiles, home).map((file) => ({
    store: store.name,
    from: at(from, file),
    to: at(to, file),
  }));
}

/**
 * Every path a layout move takes for the stores that have a former folder: the
 * whole folder, or each of the store's own files in a folder it shared.
 */
export function movedStores(home: string = palHome()): StoreMove[] {
  return STORES.filter((store) => store.formerLocation).flatMap((store) =>
    movesOf(store, home)
  );
}

export const storeHasMoved = (name: StoreName, home: string = palHome()): boolean =>
  existsSync(at(home, storeNamed(name).location));

function formerStoreOf(path: string): RecordedStore | undefined {
  return STORES.find((s) => {
    if (!s.formerLocation || !path.startsWith(`${s.formerLocation}/`)) return false;

    if (!s.formerFiles) return true;
    const below = path.slice(s.formerLocation.length + 1).split("/");
    const depth = s.formerFiles.inProjectFolders ? 2 : 1;

    return below.length === depth && s.formerFiles.match.test(below[depth - 1]);
  });
}

/** An archive path from an older layout, rewritten to where its store lives now. */
export function currentArchivePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const store = formerStoreOf(normalized);

  return store?.formerLocation
    ? `${store.location}${normalized.slice(store.formerLocation.length)}`
    : normalized;
}

/**
 * Where an archive path from either layout lands in `home`: in its store's
 * folder on this machine, so an import never splits a store across its old and
 * new folder before the owner has run the move.
 */
export function archivePathIn(path: string, home: string = palHome()): string {
  const current = currentArchivePath(path);
  const store = STORES.find(
    (s) => s.formerLocation && current.startsWith(`${s.location}/`)
  );
  if (!store) return current;
  const here = relative(home, storeLocation(store.name, home)).replaceAll("\\", "/");

  return `${here}${current.slice(store.location.length)}`;
}

/** The store's folder under `home`, created when missing. */
export function storeDir(name: StoreName, home: string = palHome()): string {
  return ensureDir(storeLocation(name, home));
}

export const reflectionsFile = () =>
  resolve(storeDir("reflections"), "algorithm-reflections.jsonl");

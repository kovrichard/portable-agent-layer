import { resolve } from "node:path";
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

export interface RecordedStore {
  name: StoreName;
  group: StoreGroup;
  /** The store's folder, relative to the PAL home, with forward slashes. */
  location: string;
  files: string;
  appendOnly: boolean;
  alsoInEventLog: boolean;
}

const STORES: readonly RecordedStore[] = [
  {
    name: "transcripts",
    group: "raw",
    location: "memory/content/claude",
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
    location: "memory/ledger",
    files: "actions.jsonl, rotated to actions-<stamp>.jsonl",
    appendOnly: true,
    alsoInEventLog: true,
  },
  {
    name: "ratings",
    group: "outside",
    location: "memory/signals",
    files: "ratings.jsonl",
    appendOnly: true,
    alsoInEventLog: true,
  },
  {
    name: "claim-checks",
    group: "outside",
    location: "memory/signals/claim-checks",
    files: "<YYYY-MM>.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "labelled-turns",
    group: "outside",
    location: "memory/adaptation",
    files: "turns-<YYYY-MM>.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "rule-events",
    group: "outside",
    location: "memory/adaptation",
    files: "rule-events.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "rule-candidates",
    group: "outside",
    location: "memory/adaptation",
    files: "candidates.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "run-estimates",
    group: "outside",
    location: "memory/learning",
    files: "run-estimates.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "reflections",
    group: "outside",
    location: "memory/learning/reflections",
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
    location: "memory/state/sessions-archive",
    files: "<YYYY-MM or undated>.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "project-history",
    group: "outside",
    location: "memory/projects",
    files: "<project>/history.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "unbound-history",
    group: "outside",
    location: "memory/state/unbound-history",
    files: "<slug>.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "review-queue",
    group: "outside",
    location: "memory/knowledge",
    files: "_review.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "import-log",
    group: "outside",
    location: "memory/state",
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

export function storeLocation(name: StoreName, home: string = palHome()): string {
  return resolve(home, ...storeNamed(name).location.split("/"));
}

/** The store's folder under `home`, created when missing. */
export function storeDir(name: StoreName, home: string = palHome()): string {
  return ensureDir(storeLocation(name, home));
}

export const reflectionsFile = () =>
  resolve(storeDir("reflections"), "algorithm-reflections.jsonl");

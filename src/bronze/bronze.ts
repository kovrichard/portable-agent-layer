import { dirname, resolve } from "node:path";
import { ensureDir, paths } from "../core/paths";

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
  dir: () => string;
  files: string;
  appendOnly: boolean;
  alsoInEventLog: boolean;
}

const STORES: readonly RecordedStore[] = [
  {
    name: "transcripts",
    group: "raw",
    dir: () => resolve(paths.content(), "claude"),
    files: "<project>/**/<file>.gz",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "events",
    group: "bronze",
    dir: () => ensureDir(resolve(paths.memory(), "events")),
    files: "<YYYY-MM>.jsonl",
    appendOnly: true,
    alsoInEventLog: true,
  },
  {
    name: "event-text",
    group: "bronze",
    dir: () => ensureDir(resolve(paths.content(), "events")),
    files: "<YYYY-MM>.jsonl",
    appendOnly: true,
    alsoInEventLog: true,
  },
  {
    name: "tool-output",
    group: "bronze",
    dir: () => ensureDir(resolve(paths.content(), "tool-output")),
    files: "<YYYY-MM>.jsonl",
    appendOnly: true,
    alsoInEventLog: true,
  },
  {
    name: "ledger",
    group: "outside",
    dir: paths.ledger,
    files: "actions.jsonl, rotated to actions-<stamp>.jsonl",
    appendOnly: true,
    alsoInEventLog: true,
  },
  {
    name: "ratings",
    group: "outside",
    dir: paths.signals,
    files: "ratings.jsonl",
    appendOnly: true,
    alsoInEventLog: true,
  },
  {
    name: "claim-checks",
    group: "outside",
    dir: () => ensureDir(resolve(paths.signals(), "claim-checks")),
    files: "<YYYY-MM>.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "labelled-turns",
    group: "outside",
    dir: paths.adaptation,
    files: "turns-<YYYY-MM>.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "rule-events",
    group: "outside",
    dir: paths.adaptation,
    files: "rule-events.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "rule-candidates",
    group: "outside",
    dir: paths.adaptation,
    files: "candidates.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "run-estimates",
    group: "outside",
    dir: paths.learning,
    files: "run-estimates.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "reflections",
    group: "outside",
    dir: () => ensureDir(dirname(paths.reflectionsFile())),
    files: "algorithm-reflections.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "progress-tree",
    group: "outside",
    dir: () => ensureDir(resolve(paths.memory(), "progress-tree")),
    files: "events.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "sessions-archive",
    group: "outside",
    dir: () => ensureDir(resolve(paths.state(), "sessions-archive")),
    files: "<YYYY-MM or undated>.jsonl",
    appendOnly: true,
    alsoInEventLog: false,
  },
  {
    name: "project-history",
    group: "outside",
    dir: paths.projectHistory,
    files: "<project>/history.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "unbound-history",
    group: "outside",
    dir: paths.unboundHistory,
    files: "<slug>.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "review-queue",
    group: "outside",
    dir: paths.knowledge,
    files: "_review.jsonl",
    appendOnly: false,
    alsoInEventLog: false,
  },
  {
    name: "import-log",
    group: "outside",
    dir: paths.state,
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

export function storeDir(name: StoreName): string {
  return storeNamed(name).dir();
}

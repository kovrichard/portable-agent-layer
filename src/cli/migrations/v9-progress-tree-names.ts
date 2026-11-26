import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { storeLocation } from "../../bronze/bronze";
import { mergeJsonlLines } from "../../core/import-merge";
import { palHome, paths } from "../../core/paths";
import { discardEmptyFolder, type Migration, type MigrationResult } from "./migration";

export const EVENTS_FILE = "events.jsonl";
const OLD_PROGRESS_TREE_LABEL = "memory/work-tree/";
const oldProgressTreeFolder = () => resolve(paths.memory(), "work-tree");
const newProgressTreeFolder = () => storeLocation("progress-tree");
const newFolderLabel = () =>
  `${relative(palHome(), newProgressTreeFolder()).replaceAll("\\", "/")}/`;

interface FolderStep {
  results: string[];
  skipped: number;
}

function mergeOldProgressTreeEvents(): number {
  const oldFile = resolve(oldProgressTreeFolder(), EVENTS_FILE);
  if (!existsSync(oldFile)) return 0;
  const newFile = resolve(newProgressTreeFolder(), EVENTS_FILE);
  const newRaw = existsSync(newFile) ? readFileSync(newFile, "utf-8") : "";
  const { text, added: keptFromNew } = mergeJsonlLines(
    readFileSync(oldFile, "utf-8"),
    newRaw
  );
  writeFileSync(newFile, text, "utf-8");
  unlinkSync(oldFile);

  return text.split("\n").filter(Boolean).length - keptFromNew;
}

function appendOldProgressTree(): FolderStep {
  const appended = mergeOldProgressTreeEvents();
  discardEmptyFolder(oldProgressTreeFolder());
  const results = [
    `${OLD_PROGRESS_TREE_LABEL}: ${appended} event(s) appended before ${newFolderLabel()}events.jsonl`,
  ];

  if (!existsSync(oldProgressTreeFolder())) return { results, skipped: 0 };

  return {
    results: [
      ...results,
      `${OLD_PROGRESS_TREE_LABEL}: skipped (holds files other than events.jsonl)`,
    ],
    skipped: 1,
  };
}

function progressTreeFolderStep(dryRun: boolean): FolderStep {
  if (!existsSync(oldProgressTreeFolder())) return { results: [], skipped: 0 };
  const bothExist = existsSync(newProgressTreeFolder());

  if (dryRun) {
    const verb = bothExist
      ? `would append its events before ${newFolderLabel()}events.jsonl`
      : `would move to ${newFolderLabel()}`;

    return { results: [`${OLD_PROGRESS_TREE_LABEL}: ${verb}`], skipped: 0 };
  }

  try {
    if (!bothExist) {
      mkdirSync(dirname(newProgressTreeFolder()), { recursive: true });
      renameSync(oldProgressTreeFolder(), newProgressTreeFolder());

      return {
        results: [`${OLD_PROGRESS_TREE_LABEL}: moved to ${newFolderLabel()}`],
        skipped: 0,
      };
    }

    return appendOldProgressTree();
  } catch (e) {
    return {
      results: [`${OLD_PROGRESS_TREE_LABEL}: skipped (${(e as Error).message})`],
      skipped: 1,
    };
  }
}

export const v9ProgressTreeNames: Migration = {
  id: "v9-progress-tree-names",
  description: "Move the progress tree's data folder from memory/work-tree",
  movesSources: true,

  check() {
    const pending = existsSync(oldProgressTreeFolder());

    return { pending, detail: pending ? OLD_PROGRESS_TREE_LABEL : undefined };
  },

  run(dryRun = false): MigrationResult {
    const { results, skipped } = progressTreeFolderStep(dryRun);

    return { migrated: results.length - skipped, skipped, results };
  },
};

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { foldHistoryInto } from "../../hooks/lib/parked-history";
import { palHome } from "../../hooks/lib/paths";
import { discardEmptyFolder, type Migration, type MigrationResult } from "./migration";

/**
 * PAL used to point the factory at `<PAL home>/dark-factory`, which put its git
 * worktrees under the PAL home. The factory keeps its folder at `~/.dark-factory`
 * on every machine, so this carries an install's tasks, worktrees and events
 * there. Nothing is overwritten: an item already in the new folder is left where
 * it is and reported as skipped, and event lines are appended.
 */
interface FactoryStep {
  label: string;
  blocked: string | null;
  done: string;
  pending: string;
  apply(): void;
}

const oldFactoryFolder = () => resolve(palHome(), "dark-factory");
function homeTheFactoryReads(): string | null {
  const pinned = process.env.DARK_FACTORY_HOME;

  return pinned && resolve(pinned) !== oldFactoryFolder() ? resolve(pinned) : null;
}

const userHomeAsSetNow = () => process.env.HOME || process.env.USERPROFILE || homedir();

const newFactoryFolder = () =>
  homeTheFactoryReads() ?? resolve(userHomeAsSetNow(), ".dark-factory");
const oldFactoryEvents = () => resolve(oldFactoryFolder(), "events.jsonl");

function subfoldersOf(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}

function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || "git failed").trim().split("\n")[0]);
  }

  return result.stdout.trim();
}

/** Moves a worktree and rewrites its registration in the repo that owns it. */
function moveWorktree(from: string, to: string): void {
  const commonDir = git(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    from
  );
  git(["--git-dir", commonDir, "worktree", "move", from, to], dirname(commonDir));
}

function repointWorktreeInTask(taskDir: string): void {
  const file = resolve(taskDir, "task.json");
  if (!existsSync(file)) return;
  let task: { worktree?: unknown };

  try {
    task = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return;
  }

  const oldPrefix = resolve(oldFactoryFolder(), "worktrees");
  if (typeof task.worktree !== "string" || !task.worktree.startsWith(oldPrefix)) return;
  const relative = task.worktree.slice(oldPrefix.length);
  task.worktree = resolve(newFactoryFolder(), "worktrees") + relative;
  writeFileSync(file, `${JSON.stringify(task, null, 2)}\n`, "utf-8");
}

function factoryFolderStep(kind: "task" | "worktree", id: string): FactoryStep {
  const from = resolve(oldFactoryFolder(), `${kind}s`, id);
  const to = resolve(newFactoryFolder(), `${kind}s`, id);

  return {
    label: `${kind}/${id}`,
    blocked: existsSync(to) ? `already in ${newFactoryFolder()}` : null,
    done: "moved",
    pending: "would move",
    apply() {
      mkdirSync(dirname(to), { recursive: true });

      if (kind === "worktree") return moveWorktree(from, to);
      renameSync(from, to);
      repointWorktreeInTask(to);
    },
  };
}

function eventsStep(): FactoryStep {
  const target = resolve(newFactoryFolder(), "events.jsonl");

  return {
    label: "events.jsonl",
    blocked: null,
    done: "appended",
    pending: "would append",
    apply() {
      foldHistoryInto(target, oldFactoryEvents());
      unlinkSync(oldFactoryEvents());
    },
  };
}

function factoryFolderSteps(): FactoryStep[] {
  const old = oldFactoryFolder();
  const steps = [
    ...subfoldersOf(resolve(old, "worktrees")).map((id) =>
      factoryFolderStep("worktree", id)
    ),
    ...subfoldersOf(resolve(old, "tasks")).map((id) => factoryFolderStep("task", id)),
  ];

  return existsSync(oldFactoryEvents()) ? [...steps, eventsStep()] : steps;
}

function discardEmptyFactoryFolders(): void {
  const old = oldFactoryFolder();

  for (const sub of ["worktrees", "tasks"]) discardEmptyFolder(resolve(old, sub));
  discardEmptyFolder(old);
}

export const v8FactoryHome: Migration = {
  id: "v8-factory-home",
  description: "Move the dark-factory folder from the PAL home to ~/.dark-factory",
  movesSources: true,

  check() {
    const steps = factoryFolderSteps().filter((step) => !step.blocked);

    return {
      pending: steps.length > 0,
      detail:
        steps.length > 0
          ? `${steps.length} item(s) under ${oldFactoryFolder()}`
          : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const results: string[] = [];
    let migrated = 0;
    let skipped = 0;

    for (const step of factoryFolderSteps()) {
      if (step.blocked) {
        skipped++;
        results.push(`${step.label}: skipped (${step.blocked})`);
        continue;
      }

      if (dryRun) {
        migrated++;
        results.push(`${step.label}: ${step.pending}`);
        continue;
      }

      try {
        step.apply();
        migrated++;
        results.push(`${step.label}: ${step.done}`);
      } catch (e) {
        skipped++;
        results.push(`${step.label}: skipped (${(e as Error).message})`);
      }
    }

    if (!dryRun) discardEmptyFactoryFolders();

    return { migrated, skipped, results };
  },
};

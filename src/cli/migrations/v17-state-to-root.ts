import { resolve } from "node:path";
import { STATE_FILES } from "../../core/machine-state";
import { palHome, paths } from "../../core/paths";
import {
  type LayoutMoveOptions,
  movesLeft,
  runLayoutMove,
  sweepLayoutMove,
  undoLayoutMove,
} from "./layout-move";
import type { Migration } from "./migration";
import type { PlannedMove } from "./move-manifest";

const ID = "v17-state-to-root";
const REACTION_AUDIT_FILES = ["reaction-samples.json", "reaction-audit.json"];

const withoutSlash = (entry: string) => entry.replace(/\/$/, "");

function stateMoves(): PlannedMove[] {
  const former = paths.formerState();
  const machine = STATE_FILES.map(withoutSlash).map((name) => ({
    from: resolve(former, name),
    to: resolve(palHome(), "state", name),
  }));
  const learned = REACTION_AUDIT_FILES.map((name) => ({
    from: resolve(former, name),
    to: resolve(palHome(), "memory", "adaptation", name),
  }));

  return [...machine, ...learned];
}

export const v17StateToRoot: Migration = {
  id: ID,
  description:
    "Move this machine's state from memory/state to state/, and the reaction audit's files to memory/adaptation",
  requiresOwner: true,
  movesSources: true,
  check() {
    return movesLeft(stateMoves()).length > 0
      ? { pending: true, detail: `run it yourself: pal cli migrate ${ID}` }
      : { pending: false };
  },
  run: (dryRun = false, options: LayoutMoveOptions = {}) =>
    runLayoutMove(ID, stateMoves(), dryRun, options),
  undo: () => undoLayoutMove(ID),
  sweep: () => sweepLayoutMove(ID, stateMoves()),
};

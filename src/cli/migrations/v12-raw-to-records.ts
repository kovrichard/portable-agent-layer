import { movedStores } from "../../bronze/bronze";
import {
  type LayoutMoveOptions,
  movesLeft,
  runLayoutMove,
  sweepLayoutMove,
  undoLayoutMove,
} from "./layout-move";
import type { Migration } from "./migration";
import type { PlannedMove } from "./move-manifest";

const ID = "v12-raw-to-records";

function rawMoves(): PlannedMove[] {
  return movedStores()
    .filter((moved) => moved.store === "transcripts")
    .map(({ from, to }) => ({ from, to }));
}

export const v12RawToRecords: Migration = {
  id: ID,
  description: "Move raw transcripts from memory/content/claude to records/raw/claude",
  requiresOwner: true,
  movesSources: true,
  check() {
    const left = movesLeft(rawMoves());

    return left.length > 0
      ? { pending: true, detail: `run it yourself: pal cli migrate ${ID}` }
      : { pending: false };
  },
  run: (dryRun = false, options: LayoutMoveOptions = {}) =>
    runLayoutMove(ID, rawMoves(), dryRun, options),
  undo: () => undoLayoutMove(ID),
  sweep: () => sweepLayoutMove(ID, rawMoves()),
};

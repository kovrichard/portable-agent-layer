import { movedStores, type StoreMove, storeHasMoved } from "../../bronze/bronze";
import {
  type LayoutMoveOptions,
  movesLeft,
  runLayoutMove,
  sweepLayoutMove,
  undoLayoutMove,
} from "./layout-move";
import type { Migration } from "./migration";

const ID = "v14-records-stores";

const recordStoreMoves = (): StoreMove[] =>
  movedStores().filter((move) => move.store !== "transcripts");

const movesOfStoresNotMoved = () =>
  recordStoreMoves().filter((move) => !storeHasMoved(move.store));

const movesOfStoresMoved = () =>
  recordStoreMoves().filter((move) => storeHasMoved(move.store));

export const v14RecordsStores: Migration = {
  id: ID,
  description: "Move the recorded stores from memory/ to records/<store>",
  requiresOwner: true,
  movesSources: true,
  check() {
    const left = movesLeft(movesOfStoresNotMoved());

    return left.length > 0
      ? { pending: true, detail: `run it yourself: pal cli migrate ${ID}` }
      : { pending: false };
  },
  run: (dryRun = false, options: LayoutMoveOptions = {}) =>
    runLayoutMove(ID, movesOfStoresNotMoved(), dryRun, options),
  undo: () => undoLayoutMove(ID),
  sweep: () => sweepLayoutMove(ID, movesOfStoresMoved(), () => true),
};

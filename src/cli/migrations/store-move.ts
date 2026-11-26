import { movedStores, type StoreName, storeHasMoved } from "../../bronze/bronze";
import {
  type LayoutMoveOptions,
  movesLeft,
  runLayoutMove,
  sweepLayoutMove,
  undoLayoutMove,
} from "./layout-move";
import type { Migration } from "./migration";

/**
 * The owner-run move of a fixed set of registry stores to their current
 * folders. The set is frozen per migration, so a store a later move gives a
 * former folder never joins an earlier one.
 */
export function storeMoveMigration(
  id: string,
  description: string,
  stores: readonly StoreName[]
): Migration {
  const moves = () => movedStores().filter((move) => stores.includes(move.store));
  const notMoved = () => moves().filter((move) => !storeHasMoved(move.store));
  const moved = () => moves().filter((move) => storeHasMoved(move.store));

  return {
    id,
    description,
    requiresOwner: true,
    movesSources: true,
    check() {
      return movesLeft(notMoved()).length > 0
        ? { pending: true, detail: `run it yourself: pal cli migrate ${id}` }
        : { pending: false };
    },
    run: (dryRun = false, options: LayoutMoveOptions = {}) =>
      runLayoutMove(id, notMoved(), dryRun, options),
    undo: () => undoLayoutMove(id),
    sweep: () => sweepLayoutMove(id, moved(), () => true),
  };
}

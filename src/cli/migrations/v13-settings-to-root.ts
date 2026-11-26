import { resolve } from "node:path";
import { palHome } from "../../core/paths";
import { formerSettingsPath, SETTINGS_FILE } from "../../core/settings";
import {
  type LayoutMoveOptions,
  movesLeft,
  runLayoutMove,
  sweepLayoutMove,
  undoLayoutMove,
} from "./layout-move";
import type { Migration } from "./migration";
import type { PlannedMove } from "./move-manifest";

const ID = "v13-settings-to-root";

function settingsMove(): PlannedMove[] {
  return [{ from: formerSettingsPath(), to: resolve(palHome(), SETTINGS_FILE) }];
}

export const v13SettingsToRoot: Migration = {
  id: ID,
  description: "Move memory/pal-settings.json to settings.json at the PAL home's root",
  requiresOwner: true,
  movesSources: true,
  check() {
    return movesLeft(settingsMove()).length > 0
      ? { pending: true, detail: `run it yourself: pal cli migrate ${ID}` }
      : { pending: false };
  },
  run: (dryRun = false, options: LayoutMoveOptions = {}) =>
    runLayoutMove(ID, settingsMove(), dryRun, options),
  undo: () => undoLayoutMove(ID),
  sweep: () => sweepLayoutMove(ID, settingsMove()),
};

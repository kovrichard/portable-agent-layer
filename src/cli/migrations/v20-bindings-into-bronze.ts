import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { storeLocation } from "../../bronze/bronze";
import { readBindings } from "../../core/project-bindings";
import { adoptBindingsFile, hasBindingHistory } from "../../progress/binding-history";
import type { Migration, MigrationResult } from "./migration";

/** Until the owner moves the stores into records/, install must not start that folder. */
const recordsLayoutAdopted = () => existsSync(dirname(storeLocation("events")));

const unrecordedBindings = () =>
  !recordsLayoutAdopted() || hasBindingHistory() ? 0 : Object.keys(readBindings()).length;

export const v20BindingsIntoBronze: Migration = {
  id: "v20-bindings-into-bronze",
  description:
    "Record this machine's bindings as events in bronze, so bindings.json can be rebuilt from them",

  check() {
    const count = unrecordedBindings();

    return {
      pending: count > 0,
      detail: count > 0 ? `${count} binding(s) with no event` : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const count = unrecordedBindings();
    if (count === 0) return { migrated: 0, skipped: 0, results: [] };

    if (dryRun)
      return { migrated: 1, skipped: 0, results: [`would record ${count} binding(s)`] };

    return {
      migrated: 1,
      skipped: 0,
      results: [`recorded ${adoptBindingsFile().length} binding(s)`],
    };
  },
};

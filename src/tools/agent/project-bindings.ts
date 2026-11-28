import { existsSync } from "node:fs";
import { readBindings } from "../../core/project-bindings";
import {
  adoptBindingsFile,
  bindingDrift,
  hasBindingHistory,
  rebuildBindingsFile,
} from "../../progress/binding-history";
import { group, leaf } from "../lib/command";
import { ok } from "./project-io";

function cmdListBindings(): undefined {
  const bindings = Object.entries(readBindings()).map(([name, path]) => ({
    name,
    path,
    exists: existsSync(path),
  }));
  ok({ bindings, history: hasBindingHistory(), drift: bindingDrift() });
}

export const bindingCommands = {
  bindings: group({
    summary: "This machine's project bindings, kept as events in bronze",
    fallback: "list",
    commands: {
      list: leaf({
        summary:
          "List each binding, whether its folder exists, and how the file differs from its history",
        run: cmdListBindings,
      }),
      adopt: leaf({
        summary: "Record the file as it is into the history (the file wins)",
        run: () => ok({ adopted: adoptBindingsFile() }),
      }),
      rebuild: leaf({
        summary: "Rewrite the file from the history (the history wins)",
        run: () => ok({ undone: rebuildBindingsFile() }),
      }),
    },
  }),
};

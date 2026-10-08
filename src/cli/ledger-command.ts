/**
 * The `pal cli ledger` command tree. The queries load only when one runs, so a
 * missing ledger dependency cannot stop the rest of the CLI, the doctor included.
 */

import { group, leaf } from "../tools/lib/command";

const JSON_OPTION = { type: "boolean", description: "Machine-readable output" } as const;

const FILTER_OPTIONS = {
  project: {
    type: "string",
    value: "<slug>",
    description: "Actions against a registered project",
  },
  since: {
    type: "string",
    value: "<7d|2026-09-01>",
    description: "A duration back from now, or a date",
  },
  until: { type: "string", value: "<date>", description: "Upper bound on the timestamp" },
  actor: { type: "string", value: "<id>", description: "Who caused it" },
  machine: { type: "string", value: "<id>", description: "Which install wrote it" },
  runtime: {
    type: "string",
    value: "<agent>",
    description: "claude, cursor, codex, copilot, opencode",
  },
  outcome: {
    type: "string",
    value: "<applied|failed|denied>",
    description: "What became of the action",
  },
  tool: { type: "string", value: "<Edit|Write>", description: "The tool that acted" },
  target: {
    type: "string",
    value: "<substring>",
    description: "Match anywhere in the recorded path",
  },
  limit: { type: "string", value: "<n>", description: "Keep the newest n matches" },
  json: JSON_OPTION,
} as const;

export const ledgerCommand = group({
  summary: "Query the action ledger",
  details: `Examples:
  pal cli ledger log --project portable-agent-layer --since 7d
  pal cli ledger log --target memory/ --outcome applied
  pal cli ledger stats --since 24h`,
  commands: {
    log: leaf({
      summary: "Matching actions, oldest first",
      options: FILTER_OPTIONS,
      run: async ({ values }) => (await import("./ledger")).ledgerLog(values),
    }),
    show: leaf({
      summary: "One action in full: change, target, standing",
      args: "<id>",
      options: { json: JSON_OPTION },
      run: async ({ positionals, values }) =>
        (await import("./ledger")).ledgerShow(positionals[0], values.json === true),
    }),
    stats: leaf({
      summary: "Counts by outcome, runtime, actor, tool, target",
      options: FILTER_OPTIONS,
      run: async ({ values }) => (await import("./ledger")).ledgerStats(values),
    }),
  },
});

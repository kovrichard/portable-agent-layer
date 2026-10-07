/**
 * Every `pal cli` command, as one tree. The commands whose code lives in
 * index.ts arrive as handlers, because index.ts routes on import and so can
 * never be imported by a test that walks this tree.
 */

import { AGENT_NAMES, AGENT_REGISTRY } from "../hooks/lib/agent-registry";
import {
  type Group,
  group,
  type Leaf,
  leaf,
  type OptionSpec,
  type OptionSpecs,
} from "../tools/lib/command";
import { usageCommand } from "../tools/token-cost";
import { builtinTools, builtinToolVerbs } from "./builtin-tools";
import { identityCommand } from "./identity";
import { knowledgeCommand } from "./knowledge";
import { ledgerCommand } from "./ledger";
import { runMigrate } from "./migrate";
import { telosCommand, timezoneCommand } from "./personal-context";
import { ruleCommand } from "./rule";
import { serverCommand } from "./server";
import { skillCommand } from "./skill";
import { subagentCommand } from "./subagent";

type Handler = Leaf["run"];
export type DebugState = "on" | "off" | "status";

export interface AdminHandlers {
  init: Handler;
  install: Handler;
  uninstall: Handler;
  update: Handler;
  export: Handler;
  import: Handler;
  status: Handler;
  doctor: Handler;
  debug(state: DebugState): void;
  version: Handler;
}

const ENVIRONMENT = `Environment:
  PAL_HOME          Override user state directory (default: ~/.pal or repo root)
  PAL_PKG           Override package root
  PAL_CLAUDE_DIR    Override Claude config dir (default: ~/.claude)
  PAL_OPENCODE_DIR  Override opencode config dir (default: ~/.config/opencode)
  PAL_CURSOR_DIR    Override Cursor config dir (default: ~/.cursor)
  PAL_COPILOT_DIR   Override Copilot config dir (default: ~/.copilot)
  PAL_CODEX_DIR     Override Codex config dir (default: ~/.codex)
  PAL_GEMINI_DIR    Override Antigravity's Gemini dir (default: ~/.gemini)
  PAL_AGENTS_DIR    Override agents dir (default: ~/.agents)`;

function agentOptions(verb: string): OptionSpecs {
  const perAgent = AGENT_NAMES.map((agent): [string, OptionSpec] => [
    agent,
    { type: "boolean", description: `${verb} ${AGENT_REGISTRY[agent].label}` },
  ]);
  return {
    ...Object.fromEntries(perAgent),
    all: { type: "boolean", description: `${verb} every supported agent` },
  };
}

const VERBOSE: OptionSpec = {
  type: "boolean",
  description: "Step-by-step log, and every passing doctor check",
};
const DRY_RUN: OptionSpec = { type: "boolean", description: "Show what would happen" };

function debugCommand(admin: AdminHandlers): Group {
  const state = (s: DebugState, summary: string) =>
    leaf({ summary, run: () => admin.debug(s) });
  return group({
    summary: "Verbose hook debug logging (persisted)",
    fallback: "status",
    commands: {
      status: state("status", "Show whether it is on, and where it logs"),
      on: state("on", "Turn it on"),
      off: state("off", "Turn it off"),
    },
  });
}

function adminCommands(admin: AdminHandlers): Record<string, Leaf | Group> {
  return {
    init: leaf({
      summary: "Scaffold PAL home and install (default: every installed agent)",
      options: { ...agentOptions("Install into"), verbose: VERBOSE },
      run: admin.init,
    }),
    install: leaf({
      summary:
        "Register hooks and skills (default: every installed agent), then run the doctor",
      options: { ...agentOptions("Install into"), verbose: VERBOSE },
      run: admin.install,
    }),
    uninstall: leaf({
      summary: "Remove hooks and skills (default: every agent)",
      options: agentOptions("Uninstall from"),
      run: admin.uninstall,
    }),
    update: leaf({ summary: "Update PAL (git pull or bun add -g)", run: admin.update }),
    export: leaf({
      summary: "Export your state to a zip",
      args: "[path]",
      options: { "dry-run": DRY_RUN },
      run: admin.export,
    }),
    import: leaf({
      summary: "Merge your state from a zip (default: the newest export or backup)",
      args: "[path]",
      options: {
        "dry-run": DRY_RUN,
        overwrite: { type: "boolean", description: "Replace instead of merging" },
      },
      run: admin.import,
    }),
    status: leaf({ summary: "Show PAL configuration", run: admin.status }),
    doctor: leaf({
      summary: "Find what is wrong and how to fix it; exits 1 on any failure",
      options: {
        verbose: { type: "boolean", description: "Show passing checks too" },
        json: { type: "boolean", description: "Machine-readable output" },
        "probe-inference": {
          type: "boolean",
          description: "Also fire a real inference call per route (costs tokens)",
        },
        probe: { type: "boolean", description: "Same as --probe-inference" },
      },
      run: admin.doctor,
    }),
    migrate: leaf({
      summary: "Run pending data migrations",
      options: {
        list: { type: "boolean", description: "List pending and done migrations" },
        "dry-run": DRY_RUN,
      },
      run: ({ argv }) => runMigrate(argv),
    }),
  };
}

export function cliTree(admin: AdminHandlers): Group {
  return group({
    summary: "Admin commands for the Portable Agent Layer",
    aliases: { "-v": "version", "--version": "version" },
    details: ENVIRONMENT,
    commands: {
      ...adminCommands(admin),
      usage: usageCommand,
      actor: identityCommand("actor"),
      machine: identityCommand("machine"),
      telos: telosCommand,
      timezone: timezoneCommand,
      knowledge: knowledgeCommand,
      ledger: ledgerCommand,
      rule: ruleCommand,
      server: serverCommand,
      skill: skillCommand,
      subagent: subagentCommand,
      ...builtinTools,
      debug: debugCommand(admin),
      version: leaf({ summary: "Print the installed PAL version", run: admin.version }),
    },
  });
}

export function inertAdmin(): AdminHandlers {
  return new Proxy({} as AdminHandlers, { get: () => () => undefined });
}

export function adminCommandNames(): string[] {
  const names = Object.keys(cliTree(inertAdmin()).commands);
  return names.filter((name) => !builtinToolVerbs.includes(name));
}

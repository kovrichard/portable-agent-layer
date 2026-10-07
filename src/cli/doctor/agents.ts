import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  AGENT_REGISTRY,
  type AgentName,
  AGENT_NAMES as REGISTERED_AGENTS,
  skillsDirOf,
} from "../../hooks/lib/agent-registry";
import { palPkg, platform } from "../../hooks/lib/paths";
import { nativeAgentsDir, staleShippedAgents } from "../../targets/lib";
import { NO_SESSION_AGENT_MESSAGE } from "../session-agent";
import { type Finding, type Fix, failing, optional, passed, warning } from "./finding";

export type { AgentName };

const AGENT_NAMES: AgentName[] = [...REGISTERED_AGENTS].sort();

export interface ToolCheck {
  name: string;
  available: boolean;
  version?: string;
}

export type DoctorResult = Record<AgentName, ToolCheck> & {
  bun: ToolCheck;
  rtk: ToolCheck;
  hasAgent: boolean;
};

function checkTool(cmd: string, versionArgs: string[] = ["--version"]): ToolCheck {
  try {
    const result = spawnSync(cmd, versionArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      timeout: 5000,
    });
    if (result.status === 0) {
      const version = (result.stdout?.toString() || "").trim().split("\n")[0];
      return { name: cmd, available: true, version };
    }
  } catch {
    // not found
  }
  return { name: cmd, available: false };
}

/**
 * Copilot ships as a VS Code extension as well as a CLI, and the extension puts
 * no `copilot` binary on PATH — but both read hooks, skills and agents out of
 * ~/.copilot. Fall back to that directory so PAL's copilot checks still run.
 */
function checkCopilot(): ToolCheck {
  const cli = checkTool("copilot", ["version"]);
  if (cli.available) return cli;
  if (existsSync(platform.copilotDir())) {
    return { name: "copilot", available: true, version: "~/.copilot (no CLI on PATH)" };
  }
  return cli;
}

/**
 * The Cursor CLI installs `cursor-agent` (and `agent`) and no `cursor` command;
 * `cursor` is the editor's shell command. Both read ~/.cursor, so either counts.
 */
function checkCursor(): ToolCheck {
  const cli = checkTool("cursor-agent");
  if (cli.available) return cli;
  return checkTool("cursor");
}

const AGENT_PROBES: Record<AgentName, () => ToolCheck> = {
  claude: () => checkTool("claude"),
  opencode: () => checkTool("opencode"),
  cursor: checkCursor,
  copilot: checkCopilot,
  codex: () => checkTool("codex"),
};

function agentChecks(
  probe: (agent: AgentName) => ToolCheck
): Record<AgentName, ToolCheck> {
  return Object.fromEntries(
    REGISTERED_AGENTS.map((agent) => [agent, probe(agent)])
  ) as Record<AgentName, ToolCheck>;
}

export function detectAgents(): DoctorResult {
  const bun = { name: "bun", available: true, version: Bun.version };
  if (process.env.PAL_SKIP_DOCTOR === "1") {
    return {
      ...agentChecks((agent) => ({ name: agent, available: true })),
      bun,
      rtk: { name: "rtk", available: true },
      hasAgent: true,
    };
  }
  const agents = agentChecks((agent) => AGENT_PROBES[agent]());
  return {
    ...agents,
    bun,
    rtk: checkTool("rtk"),
    hasAgent: Object.values(agents).some((tool) => tool.available),
  };
}

export function installedAgents(result: DoctorResult): AgentName[] {
  return AGENT_NAMES.filter((name) => result[name].available);
}

interface AgentWiring {
  hookFile?: () => string;
  instructions?: { file: () => string; name: string };
}

const WIRING: Record<AgentName, AgentWiring> = {
  claude: {
    hookFile: () => resolve(platform.claudeDir(), "settings.json"),
    instructions: {
      file: () => resolve(platform.claudeDir(), "CLAUDE.md"),
      name: "CLAUDE.md",
    },
  },
  codex: { hookFile: () => resolve(platform.codexDir(), "hooks.json") },
  copilot: { hookFile: () => resolve(platform.copilotDir(), "hooks", "pal-hooks.json") },
  cursor: { hookFile: () => resolve(platform.cursorDir(), "hooks.json") },
  opencode: {},
};

const labelOf = (agent: AgentName) => AGENT_REGISTRY[agent].label;

const reinstall = (agent: AgentName): Fix => ({
  say: `Reinstall PAL for ${labelOf(agent)}`,
  command: `pal cli install --${agent}`,
  external: false,
});

/** Hook-config keys that carry a shell command: cross-platform and per-shell variants. */
function isHookCommandField(key: string): boolean {
  return key === "command" || key === "bash" || key === "powershell";
}

function extractAllHookCommands(obj: unknown, out: string[] = []): string[] {
  if (Array.isArray(obj)) {
    for (const item of obj) extractAllHookCommands(item, out);
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (isHookCommandField(k) && typeof v === "string") {
        out.push(v);
      } else {
        extractAllHookCommands(v, out);
      }
    }
  }
  return out;
}

/**
 * True when a hook command names its agent, by env prefix or by argv flag.
 *
 * An env prefix only parses in one shell family, so hook configs whose host
 * shell is unknown declare the agent with a shell-agnostic `--agent=` flag.
 */
function declaresAgent(cmd: string, agentName: string): boolean {
  return (
    cmd.startsWith(`PAL_AGENT=${agentName} `) ||
    cmd.startsWith(`$env:PAL_AGENT='${agentName}'; `) ||
    cmd.includes(`--agent=${agentName}`)
  );
}

const SCRIPT =
  /"([^"]+\.(?:ts|js|mjs|sh|ps1))"|'([^']+\.(?:ts|js|mjs|sh|ps1))'|(\S+\.(?:ts|js|mjs|sh|ps1))(?=\s|$)/g;

function scriptPaths(cmd: string): string[] {
  return Array.from(cmd.matchAll(SCRIPT), (m) => m[1] ?? m[2] ?? m[3] ?? "").filter(
    isAbsolute
  );
}

function isPalHook(cmd: string, agent: AgentName): boolean {
  return (
    declaresAgent(cmd, agent) ||
    scriptPaths(cmd).some((path) => /[\\/]src[\\/]hooks[\\/][^\\/]+$/.test(path))
  );
}

function readHookCommands(file: string): string[] | "missing" | "unreadable" {
  if (!existsSync(file)) return "missing";
  try {
    const data = JSON.parse(readFileSync(file, "utf-8"));
    return extractAllHookCommands(data.hooks ?? data);
  } catch {
    return "unreadable";
  }
}

function hookFindings(agent: AgentName, file: string): Finding[] {
  const label = labelOf(agent);
  const commands = readHookCommands(file);
  if (commands === "unreadable")
    return [
      failing(
        `${agent}.hooks.unreadable`,
        `${label} hook config is not valid JSON (${file})`,
        {
          say: `Fix the JSON in ${file}, then reinstall`,
          command: `pal cli install --${agent}`,
          external: false,
        }
      ),
    ];
  const pal = commands === "missing" ? [] : commands.filter((c) => isPalHook(c, agent));
  if (!pal.some((c) => c.includes("LoadContext")))
    return [
      failing(
        `${agent}.hooks.missing`,
        `${label} hooks are not registered`,
        reinstall(agent)
      ),
    ];

  const findings = [passed(`${agent}.hooks`, `${label}: ${pal.length} hooks registered`)];
  const undeclared = pal.filter((c) => !declaresAgent(c, agent));
  if (undeclared.length > 0)
    findings.push(
      failing(
        `${agent}.hooks.undeclared`,
        `${label}: ${undeclared.length} of ${pal.length} hooks do not name ${agent} as their agent`,
        reinstall(agent)
      )
    );
  const broken = pal.filter((c) => scriptPaths(c).some((path) => !existsSync(path)));
  if (broken.length > 0)
    findings.push(
      failing(
        `${agent}.hooks.scripts`,
        `${label}: ${broken.length} of ${pal.length} hooks run a script that no longer exists (${scriptPaths(broken[0]).find((p) => !existsSync(p))})`,
        reinstall(agent)
      )
    );
  return findings;
}

function opencodePluginFindings(): Finding[] {
  const installed = resolve(platform.opencodeDir(), "plugins", "pal-plugin.ts");
  const source = resolve(palPkg(), "src", "targets", "opencode", "plugin.ts");
  if (!existsSync(installed))
    return [
      failing(
        "opencode.hooks.missing",
        "opencode plugin is not installed",
        reinstall("opencode")
      ),
    ];
  if (existsSync(source) && statSync(installed).mtimeMs < statSync(source).mtimeMs)
    return [
      warning(
        "opencode.plugin.stale",
        "opencode plugin is older than PAL's — recent fixes have not reached opencode",
        reinstall("opencode")
      ),
    ];
  return [passed("opencode.hooks", "opencode plugin installed and current")];
}

function subagentFinding(agent: AgentName): Finding {
  const label = labelOf(agent);
  const stale = staleShippedAgents(nativeAgentsDir(agent), agent);
  if (stale.length === 0)
    return passed(`${agent}.subagents`, `${label}: subagents match this PAL version`);
  return warning(
    `${agent}.subagents`,
    `${label}: installed subagents differ from this PAL version — ${stale.join(", ")}`,
    reinstall(agent)
  );
}

function countSkills(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => existsSync(resolve(dir, f, "SKILL.md"))).length;
}

function oneAgentFindings(agent: AgentName): Finding[] {
  const layout = WIRING[agent];
  const label = labelOf(agent);
  const skills = countSkills(skillsDirOf(agent));
  const findings = [
    skills > 0
      ? passed(`${agent}.skills`, `${label}: ${skills} skills`)
      : warning(`${agent}.skills`, `${label} has no PAL skills`, reinstall(agent)),
  ];
  findings.push(
    ...(layout.hookFile
      ? hookFindings(agent, layout.hookFile())
      : opencodePluginFindings()),
    subagentFinding(agent)
  );
  if (layout.instructions) {
    const { file, name } = layout.instructions;
    findings.push(
      existsSync(file())
        ? passed(`${agent}.instructions`, `${name} present`)
        : failing(`${agent}.instructions`, `${name} is missing`, reinstall(agent))
    );
  }
  return findings;
}

export function agentFindings(agents: AgentName[]): Finding[] {
  if (agents.length === 0) return [];
  const agentsMd = resolve(platform.opencodeDir(), "AGENTS.md");
  return [
    existsSync(agentsMd)
      ? passed("agents-md", "AGENTS.md present")
      : failing("agents-md", "AGENTS.md is missing", {
          say: "Reinstall PAL",
          command: "pal cli install",
          external: false,
        }),
    ...agents.flatMap(oneAgentFindings),
  ];
}

export function rosterFindings(agents: AgentName[]): Finding[] {
  if (agents.length === 0)
    return [
      failing("agents.none", "No supported agent is installed", {
        say: NO_SESSION_AGENT_MESSAGE,
      }),
    ];
  const others = AGENT_NAMES.filter((name) => !agents.includes(name));
  if (others.length === 0) return [];
  return [
    optional(
      "agents.others",
      `Other agents PAL supports — ${others.map(labelOf).join(", ")}`,
      {
        say: `install it, then run pal cli install --${others.length === 1 ? others[0] : "<agent>"}`,
      }
    ),
  ];
}

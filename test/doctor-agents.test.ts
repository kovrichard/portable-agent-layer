import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { agentFindings, rosterFindings } from "../src/cli/doctor/agents";
import { copyAgents } from "../src/targets/lib";

const DIR_VARS = {
  PAL_CLAUDE_DIR: "claude",
  PAL_CURSOR_DIR: "cursor",
  PAL_CODEX_DIR: "codex",
  PAL_COPILOT_DIR: "copilot",
  PAL_OPENCODE_DIR: "opencode",
  PAL_AGENTS_DIR: "agents",
  PAL_PKG: "pkg",
} as const;

let ROOT: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  ROOT = mkdtempSync(resolve(tmpdir(), "pal-doctor-agents-"));
  for (const [name, dir] of Object.entries(DIR_VARS)) {
    saved[name] = process.env[name];
    process.env[name] = resolve(ROOT, dir);
  }
  write(resolve(ROOT, "opencode", "AGENTS.md"), "# PAL");
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(ROOT, { recursive: true, force: true });
});

function write(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function hookScript(name: string): string {
  return write(resolve(ROOT, "pkg", "src", "hooks", `${name}.ts`), "");
}

function palCommand(script: string, agent = "claude"): string {
  return `bun run ${script} --agent=${agent}`;
}

function claudeSettings(commands: string[]): void {
  write(
    resolve(ROOT, "claude", "settings.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: commands.map((command) => ({ command })) }],
      },
    })
  );
}

function aSkill(skillsDir: string): void {
  write(resolve(skillsDir, "telos", "SKILL.md"), "---\nname: telos\n---\n");
}

function healthyClaude(): void {
  claudeSettings([palCommand(hookScript("LoadContext"))]);
  aSkill(resolve(ROOT, "claude", "skills"));
  write(resolve(ROOT, "claude", "CLAUDE.md"), "# PAL");
}

const problems = (findings: ReturnType<typeof agentFindings>) =>
  findings.filter((f) => f.severity === "fail" || f.severity === "warn");
const byId = (findings: ReturnType<typeof agentFindings>, id: string) =>
  findings.find((f) => f.id === id);

describe("an installed agent", () => {
  test("a healthy Claude Code install has no problems", () => {
    healthyClaude();

    expect(problems(agentFindings(["claude"]))).toEqual([]);
  });

  test("hooks that are not registered fail, with the reinstall command", () => {
    healthyClaude();
    rmSync(resolve(ROOT, "claude", "settings.json"));

    const finding = byId(agentFindings(["claude"]), "claude.hooks.missing");
    expect(finding?.severity).toBe("fail");
    expect(finding?.fix?.command).toBe("pal cli install --claude");
  });

  test("a hook config that is not valid JSON fails as unreadable", () => {
    healthyClaude();
    write(resolve(ROOT, "claude", "settings.json"), "{ not json");

    expect(byId(agentFindings(["claude"]), "claude.hooks.unreadable")?.severity).toBe(
      "fail"
    );
  });

  test("hooks pointing at scripts that no longer exist fail", () => {
    healthyClaude();
    claudeSettings([
      palCommand(hookScript("LoadContext")),
      palCommand(resolve(ROOT, "moved", "src", "hooks", "StopOrchestrator.ts")),
    ]);

    const finding = byId(agentFindings(["claude"]), "claude.hooks.scripts");
    expect(finding?.severity).toBe("fail");
    expect(finding?.title).toContain("1 of 2");
    expect(finding?.fix?.command).toBe("pal cli install --claude");
  });

  test("a quoted script path with spaces is found", () => {
    healthyClaude();
    const spaced = write(resolve(ROOT, "pkg dir", "LoadContext.ts"), "");
    claudeSettings([`bun run "${spaced}" --agent=claude`]);

    expect(byId(agentFindings(["claude"]), "claude.hooks.scripts")).toBeUndefined();
  });

  test("the user's own hooks are not blamed on PAL", () => {
    healthyClaude();
    claudeSettings([palCommand(hookScript("LoadContext")), "/opt/hooks/my-own-hook.sh"]);

    expect(problems(agentFindings(["claude"]))).toEqual([]);
  });

  test("a PAL hook that does not name its agent fails", () => {
    healthyClaude();
    claudeSettings([
      palCommand(hookScript("LoadContext")),
      `bun run ${hookScript("StopOrchestrator")}`,
    ]);

    const finding = byId(agentFindings(["claude"]), "claude.hooks.undeclared");
    expect(finding?.severity).toBe("fail");
    expect(finding?.title).toContain("1 of 2");
  });

  test("no skills warns, with the reinstall command", () => {
    healthyClaude();
    rmSync(resolve(ROOT, "claude", "skills"), { recursive: true });

    const finding = byId(agentFindings(["claude"]), "claude.skills");
    expect(finding?.severity).toBe("warn");
    expect(finding?.fix?.command).toBe("pal cli install --claude");
  });

  test("a missing CLAUDE.md fails", () => {
    healthyClaude();
    rmSync(resolve(ROOT, "claude", "CLAUDE.md"));

    expect(byId(agentFindings(["claude"]), "claude.instructions")?.severity).toBe("fail");
  });

  test("a missing AGENTS.md fails, with the reinstall command", () => {
    healthyClaude();
    rmSync(resolve(ROOT, "opencode", "AGENTS.md"));

    const finding = byId(agentFindings(["claude"]), "agents-md");
    expect(finding?.severity).toBe("fail");
    expect(finding?.fix?.command).toBe("pal cli install");
  });

  test("an agent that is not installed is not checked", () => {
    expect(problems(agentFindings([]))).toEqual([]);
  });
});

describe("opencode's plugin", () => {
  function opencode(sourceAge: number): void {
    aSkill(resolve(ROOT, "agents", "skills"));
    const installed = write(resolve(ROOT, "opencode", "plugins", "pal-plugin.ts"), "");
    const source = write(
      resolve(ROOT, "pkg", "src", "targets", "opencode", "plugin.ts"),
      ""
    );
    const now = Date.now() / 1000;
    utimesSync(installed, now, now);
    utimesSync(source, now + sourceAge, now + sourceAge);
  }

  test("an up-to-date plugin has no problems", () => {
    opencode(0);

    expect(problems(agentFindings(["opencode"]))).toEqual([]);
  });

  test("a missing plugin fails", () => {
    opencode(0);
    rmSync(resolve(ROOT, "opencode", "plugins", "pal-plugin.ts"));

    expect(byId(agentFindings(["opencode"]), "opencode.hooks.missing")?.severity).toBe(
      "fail"
    );
  });

  test("a plugin older than PAL's source warns to reinstall", () => {
    opencode(600);

    const finding = byId(agentFindings(["opencode"]), "opencode.plugin.stale");
    expect(finding?.severity).toBe("warn");
    expect(finding?.fix?.command).toBe("pal cli install --opencode");
  });
});

describe("installed subagents", () => {
  const shippedAgent = "---\nname: researcher\nclaude:\n  model: sonnet\n---\nbody v1\n";

  function installedSubagent(): string {
    healthyClaude();
    write(resolve(ROOT, "pkg", "assets", "agents", "researcher.md"), shippedAgent);
    copyAgents();
    return resolve(ROOT, "claude", "agents", "researcher.md");
  }

  test("a subagent installed from this PAL version has no problems", () => {
    installedSubagent();

    expect(byId(agentFindings(["claude"]), "claude.subagents")?.severity).toBe("ok");
  });

  test.each([
    ["edited after install", (path: string) => write(path, "stale copy")],
    ["deleted after install", (path: string) => rmSync(path)],
  ])("a subagent %s warns, naming it, with the reinstall command", (_case, drift) => {
    drift(installedSubagent());

    const finding = byId(agentFindings(["claude"]), "claude.subagents");
    expect(finding?.severity).toBe("warn");
    expect(finding?.title).toContain("researcher");
    expect(finding?.fix?.command).toBe("pal cli install --claude");
  });

  test("a changed source warns until the next install", () => {
    installedSubagent();
    write(
      resolve(ROOT, "pkg", "assets", "agents", "researcher.md"),
      shippedAgent.replace("v1", "v2")
    );

    expect(byId(agentFindings(["claude"]), "claude.subagents")?.severity).toBe("warn");
    copyAgents();
    expect(byId(agentFindings(["claude"]), "claude.subagents")?.severity).toBe("ok");
  });

  test("codex has no subagents to check", () => {
    expect(byId(agentFindings(["codex"]), "codex.subagents")).toBeUndefined();
  });
});

describe("which agents are installed", () => {
  test("none fails", () => {
    expect(rosterFindings([])[0].severity).toBe("fail");
  });

  test("the agents PAL supports but are not installed are listed as optional", () => {
    const [finding] = rosterFindings(["claude", "codex", "copilot", "cursor"]);

    expect(finding.severity).toBe("optional");
    expect(finding.title).toContain("opencode");
  });

  test("every supported agent installed lists nothing", () => {
    expect(rosterFindings(["claude", "codex", "copilot", "cursor", "opencode"])).toEqual(
      []
    );
  });
});

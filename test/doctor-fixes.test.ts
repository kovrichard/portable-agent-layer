/**
 * Every fix the doctor hands out as PAL's own command is run here, exactly as
 * printed, in a sandbox that was broken on purpose — and must clear its finding.
 * Slow by design, so it runs in its own CI job: PAL_FIX_PROOFS=1.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { linkDir, linkFile } from "./lib/links";
import { removeOnceReleased } from "./lib/remove-once-released";
import { runSync } from "./lib/run";
import { outsideRepoHome } from "./lib/test-home";

type Mode = "package" | "repo";

interface Finding {
  id: string;
  severity: string;
  fix?: { say: string; command?: string; external?: boolean };
}

interface Sandbox {
  root: string;
  pkg: string;
}

const REPO = resolve(import.meta.dir, "..");
const PROVING = process.env.PAL_FIX_PROOFS === "1" && process.platform !== "win32";
const AGENT_DIRS = [".claude", ".opencode", ".cursor", ".copilot", ".codex", ".agents"];
const STATE_DIRS = ["home", "user", ...AGENT_DIRS];

const UNPROVEN: Record<string, string> = {
  identity: "its questions need a terminal",
  update: "it needs a newer release on npm",
  "playwright.missing": "it downloads a 150 MB browser",
};

function bunCache(): string {
  return runSync(["bun", "pm", "cache"]).stdout.trim();
}

function sandboxEnv(root: string): Record<string, string> {
  const {
    PAL_SKIP_DOCTOR: _skip,
    PAL_PKG: _pkg,
    PAL_TEST_SANDBOX: _sandbox,
    CLAUDE_CODE_OAUTH_TOKEN: _token,
    ...inherited
  } = process.env;
  const dirs = Object.fromEntries(
    AGENT_DIRS.map((dir) => [`PAL_${dir.slice(1).toUpperCase()}_DIR`, resolve(root, dir)])
  );
  return {
    ...(inherited as Record<string, string>),
    ...dirs,
    HOME: resolve(root, "user"),
    PATH: [resolve(root, "bin"), resolve(root, ".bun", "bin"), "/usr/bin", "/bin"].join(
      ":"
    ),
    BUN_INSTALL: resolve(root, ".bun"),
    BUN_INSTALL_CACHE_DIR: bunCache(),
    PAL_HOME: resolve(root, "home"),
    PAL_SKIP_BROWSER_INSTALL: "1",
  };
}

function sh(root: string, command: string, cwd = root) {
  const result = runSync(["sh", "-c", command], {
    cwd,
    env: sandboxEnv(root),
    timeout: 120_000,
  });
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

function fakeAgentsOnPath(root: string): void {
  const bin = resolve(root, "bin");
  mkdirSync(bin, { recursive: true });
  for (const agent of ["claude", "opencode", "cursor-agent", "copilot", "codex"]) {
    writeFileSync(resolve(bin, agent), "#!/bin/sh\necho 1.0.0\n");
    chmodSync(resolve(bin, agent), 0o755);
  }
  linkFile(process.execPath, resolve(bin, "bun"));
}

function installFromTarball(root: string): string {
  const packed = runSync(["bun", "pm", "pack", "--destination", root, "--quiet"], {
    cwd: REPO,
  });
  if (packed.status !== 0) throw new Error(`bun pm pack failed: ${packed.stderr}`);
  const tarball = readdirSync(root).find((file) => file.endsWith(".tgz"));
  const added = sh(root, `bun add -g ${resolve(root, tarball as string)}`);
  if (!added.ok) throw new Error(`bun add -g failed: ${added.output}`);
  return resolve(
    root,
    ".bun",
    "install",
    "global",
    "node_modules",
    "portable-agent-layer"
  );
}

function trackedAndNewFiles(): string[] {
  return runSync(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: REPO,
    }
  )
    .stdout.split("\0")
    .filter((file) => file && existsSync(resolve(REPO, file)));
}

function checkOut(root: string): string {
  const pkg = resolve(root, "checkout");
  for (const file of trackedAndNewFiles())
    cpSync(resolve(REPO, file), resolve(pkg, file), { verbatimSymlinks: true });
  mkdirSync(resolve(pkg, ".git"));
  linkDir(resolve(REPO, "node_modules"), resolve(pkg, "node_modules"));
  const linked = sh(root, "bun link", pkg);
  if (!linked.ok) throw new Error(`bun link failed: ${linked.output}`);
  return pkg;
}

function doctor(sandbox: Sandbox): Finding[] {
  const cli = resolve(sandbox.pkg, "src", "cli", "index.ts");
  const { output } = sh(sandbox.root, `bun ${cli} cli doctor --json`);
  return JSON.parse(output.slice(output.indexOf("{"))).findings.filter(
    (f: Finding) => f.severity === "fail" || f.severity === "warn"
  );
}

function palFixable(sandbox: Sandbox): Finding[] {
  return doctor(sandbox).filter((f) => f.fix?.command && f.fix.external === false);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function editJson(path: string, edit: (data: Record<string, unknown>) => void): void {
  const data = readJson(path);
  edit(data);
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function knowEachOther(root: string): void {
  editJson(resolve(root, "home", "memory", "pal-settings.json"), (settings) => {
    settings.identity = {
      principal: { name: "Ada", timezone: "UTC" },
      ai: { name: "Hal", catchphrase: "Ready." },
    };
  });
}

function snapshot(root: string): void {
  for (const dir of STATE_DIRS)
    cpSync(resolve(root, dir), resolve(root, "baseline", dir), {
      recursive: true,
      verbatimSymlinks: true,
    });
}

function restore(root: string): void {
  for (const dir of STATE_DIRS) {
    removeOnceReleased(resolve(root, dir));
    cpSync(resolve(root, "baseline", dir), resolve(root, dir), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
}

function prepare(mode: Mode): Sandbox {
  const root = resolve(outsideRepoHome(import.meta.file), mode);
  removeOnceReleased(root);
  for (const dir of STATE_DIRS) mkdirSync(resolve(root, dir), { recursive: true });
  fakeAgentsOnPath(root);
  const pkg = mode === "package" ? installFromTarball(root) : checkOut(root);
  const installed = sh(root, "pal cli install");
  if (!existsSync(resolve(root, "home", "memory", "pal-settings.json")))
    throw new Error(`pal cli install failed: ${installed.output}`);
  knowEachOther(root);
  snapshot(root);
  return { root, pkg };
}

const at = (sandbox: Sandbox, ...parts: string[]) => resolve(sandbox.root, ...parts);

function withoutHooks(path: string): void {
  editJson(path, (settings) => {
    delete settings.hooks;
  });
}

function undeclared(path: string): void {
  writeFileSync(path, readFileSync(path, "utf-8").replaceAll(" --agent=claude", ""));
}

function retiredHookScript(sandbox: Sandbox): void {
  editJson(at(sandbox, ".claude", "settings.json"), (settings) => {
    const hooks = settings.hooks as Record<string, unknown[]>;
    const script = resolve(sandbox.pkg, "src", "hooks", "RetiredHook.ts");
    hooks.Stop.push({
      hooks: [{ type: "command", command: `bun run ${script} --agent=claude` }],
    });
  });
}

interface Breakage {
  id: string;
  modes?: Mode[];
  setup?: (sandbox: Sandbox) => void;
  break: (sandbox: Sandbox) => void;
  path?: (sandbox: Sandbox) => string;
}

const BREAKAGES: Breakage[] = [
  {
    id: "settings.missing",
    break: (s) => removeOnceReleased(at(s, "home", "memory", "pal-settings.json")),
  },
  {
    id: "telos.missing",
    break: (s) => removeOnceReleased(at(s, "home", "telos")),
  },
  {
    id: "binding.demo",
    break: (s) => {
      sh(s.root, `pal cli project create demo --path ${at(s, "moved-away")}`);
    },
    path: (s) => {
      mkdirSync(at(s, "demo"), { recursive: true });
      return at(s, "demo");
    },
  },
  {
    id: "migration.debug-log-prev",
    break: (s) =>
      writeFileSync(
        at(s, "home", "debug", "debug.log.prev"),
        "[2026-01-01 00:00:00] old\n"
      ),
  },
  {
    id: "claude.hooks.missing",
    break: (s) => withoutHooks(at(s, ".claude", "settings.json")),
  },
  {
    id: "claude.hooks.undeclared",
    break: (s) => undeclared(at(s, ".claude", "settings.json")),
  },
  { id: "claude.hooks.scripts", break: retiredHookScript },
  {
    id: "claude.instructions",
    break: (s) => removeOnceReleased(at(s, ".claude", "CLAUDE.md")),
  },
  {
    id: "claude.skills",
    break: (s) => removeOnceReleased(at(s, ".claude", "skills")),
  },
  {
    id: "codex.hooks.unreadable",
    break: (s) => writeFileSync(at(s, ".codex", "hooks.json"), "{"),
  },
  {
    id: "cursor.hooks.missing",
    break: (s) => removeOnceReleased(at(s, ".cursor", "hooks.json")),
  },
  {
    id: "copilot.hooks.missing",
    break: (s) => removeOnceReleased(at(s, ".copilot", "hooks", "pal-hooks.json")),
  },
  {
    id: "opencode.hooks.missing",
    break: (s) => removeOnceReleased(at(s, ".opencode", "plugins", "pal-plugin.ts")),
  },
  {
    id: "opencode.plugin.stale",
    break: (s) => utimesSync(at(s, ".opencode", "plugins", "pal-plugin.ts"), 0, 0),
  },
  { id: "agents-md", break: (s) => removeOnceReleased(at(s, ".opencode", "AGENTS.md")) },
  {
    id: "pal.path",
    modes: ["repo"],
    break: (s) => removeOnceReleased(at(s, ".bun", "bin", "pal")),
  },
  {
    id: "dependencies",
    modes: ["package"],
    break: (s) => {
      for (const dependency of ["fast-myers-diff", "@clack/prompts", "adm-zip"])
        removeOnceReleased(
          at(s, ".bun", "install", "global", "node_modules", dependency)
        );
    },
  },
];

describe.skipIf(!PROVING).each(["package", "repo"] as Mode[])(
  "the doctor's own fixes, %s mode",
  (mode) => {
    let sandbox: Sandbox;

    beforeAll(() => {
      sandbox = prepare(mode);
    }, 300_000);

    test("a fresh install leaves nothing for PAL to fix", () => {
      const left = palFixable(sandbox).filter((f) => !(f.id in UNPROVEN));
      expect(left.map((f) => f.id)).toEqual([]);
    }, 60_000);

    for (const breakage of BREAKAGES.filter((b) => !b.modes || b.modes.includes(mode))) {
      test(`${breakage.id}: the printed command clears it`, () => {
        restore(sandbox.root);
        breakage.break(sandbox);
        const finding = doctor(sandbox).find((f) => f.id === breakage.id);
        expect(finding?.fix).toMatchObject({ external: false });

        const command = (finding?.fix?.command as string).replace(
          "<path>",
          breakage.path?.(sandbox) ?? "<path>"
        );
        const ran = sh(sandbox.root, command);
        expect(ran.output).toBeString();

        expect(doctor(sandbox).map((f) => f.id)).not.toContain(breakage.id);
      }, 120_000);
    }
  }
);

import { chmodSync, copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentName } from "../core/agent-registry";
import { assets, platform } from "../core/paths";
import { log } from "./log";

export type StatuslineTarget = Extract<AgentName, "claude" | "cursor" | "antigravity">;

interface StatuslineSlot {
  dir: () => string;
  /** The script path as the agent's own config spells it, without the extension. */
  script: string;
  powershellFlags: string;
  extra?: Record<string, unknown>;
}

const STATUSLINE: Record<StatuslineTarget, StatuslineSlot> = {
  claude: {
    dir: platform.claudeDir,
    script: "~/.claude/statusline",
    powershellFlags: "-NoProfile -ExecutionPolicy Bypass",
    extra: { refreshInterval: 20 },
  },
  cursor: {
    dir: platform.cursorDir,
    script: "~/.cursor/statusline",
    powershellFlags: "-NoProfile",
    extra: { updateIntervalMs: 300, timeoutMs: 2000 },
  },
  antigravity: {
    dir: platform.antigravityCliDir,
    script: "~/.gemini/antigravity-cli/statusline",
    powershellFlags: "-NoProfile -ExecutionPolicy Bypass",
  },
};

function statuslineAgentDir(target: StatuslineTarget): string {
  return STATUSLINE[target].dir();
}

function windowsStatuslineCommand(target: StatuslineTarget): string {
  const script = resolve(statuslineAgentDir(target), "statusline.ps1");

  return `powershell ${STATUSLINE[target].powershellFlags} -File "${script}"`;
}

function statuslineCommand(target: StatuslineTarget, os: NodeJS.Platform): string {
  return os === "win32"
    ? windowsStatuslineCommand(target)
    : `${STATUSLINE[target].script}.sh`;
}

function isPalStatuslineCommand(cmd: string, target: StatuslineTarget): boolean {
  return cmd.replaceAll("\\", "/").includes(STATUSLINE[target].script.slice(2));
}

/** Copy the statusline script into the agent's config dir for the current platform */
export function copyStatusline(target: StatuslineTarget = "claude"): boolean {
  const agentDir = statuslineAgentDir(target);
  mkdirSync(agentDir, { recursive: true });

  const isPlatformWin32 = process.platform === "win32";
  const sourcePath = isPlatformWin32
    ? assets.statuslineScriptPs1()
    : assets.statuslineScriptBash();
  const scriptName = isPlatformWin32 ? "statusline.ps1" : "statusline.sh";
  const destPath = resolve(agentDir, scriptName);

  if (!existsSync(sourcePath)) {
    log.warn(`Statusline script not found at ${sourcePath}`);

    return false;
  }

  try {
    copyFileSync(sourcePath, destPath);

    if (process.platform !== "win32") {
      chmodSync(destPath, 0o755);
    }

    log.success(`Statusline installed to ${destPath}`);

    return true;
  } catch (e) {
    log.warn(`Failed to copy statusline script: ${e}`);

    return false;
  }
}

/** Remove the statusline script from the agent's config dir */
export function removeStatusline(target: StatuslineTarget = "claude"): boolean {
  const isPlatformWin32 = process.platform === "win32";
  const scriptName = isPlatformWin32 ? "statusline.ps1" : "statusline.sh";
  const scriptPath = resolve(statuslineAgentDir(target), scriptName);

  if (!existsSync(scriptPath)) {
    log.info("Statusline script not found, nothing to remove");

    return true;
  }

  try {
    unlinkSync(scriptPath);
    log.success(`Removed statusline script from ${scriptPath}`);

    return true;
  } catch (e) {
    log.warn(`Failed to remove statusline script: ${e}`);

    return false;
  }
}

function isOldGetContentClaudeCommand(cmd: string): boolean {
  return cmd.includes("Get-Content -Raw");
}

function isStaleWindowsClaudeCommand(cmd: string, os: NodeJS.Platform): boolean {
  const missingBypass =
    cmd.includes("powershell") && !cmd.includes("-ExecutionPolicy Bypass");

  return (
    os === "win32" &&
    isPalStatuslineCommand(cmd, "claude") &&
    (missingBypass || cmd.includes("-File ~/"))
  );
}

function claudeStatuslineNeedsRefresh(cmd: string, os: NodeJS.Platform): boolean {
  return isOldGetContentClaudeCommand(cmd) || isStaleWindowsClaudeCommand(cmd, os);
}

function addMissingExtras(
  statusLine: Record<string, unknown>,
  target: StatuslineTarget
): void {
  for (const [key, value] of Object.entries(STATUSLINE[target].extra ?? {})) {
    if (!(key in statusLine)) statusLine[key] = value;
  }
}

/** Add statusLine config if not already present or if using an old broken command */
export function addStatuslineConfig(
  settings: Record<string, unknown>,
  target: StatuslineTarget = "claude",
  os: NodeJS.Platform = process.platform
): Record<string, unknown> {
  const statusLine = settings.statusLine as Record<string, unknown> | undefined;

  if (statusLine && typeof statusLine === "object" && statusLine.command) {
    const cmd = statusLine.command as string;

    if (target === "claude") {
      if (!claudeStatuslineNeedsRefresh(cmd, os)) {
        if (isPalStatuslineCommand(cmd, "claude")) addMissingExtras(statusLine, target);

        return settings;
      }
    } else if (!isPalStatuslineCommand(cmd, target)) {
      return settings;
    }
  }

  const command = statuslineCommand(target, os);
  settings.statusLine = {
    type: "command",
    command,
    padding: 2,
    ...STATUSLINE[target].extra,
  };

  return settings;
}

/** Remove statusLine config from settings (PAL-owned only, except for Claude) */
export function removeStatuslineConfig(
  settings: Record<string, unknown>,
  target: StatuslineTarget = "claude"
): Record<string, unknown> {
  const statusLine = settings.statusLine as Record<string, unknown> | undefined;
  if (!statusLine || typeof statusLine !== "object") {
    return settings;
  }

  if (target === "claude") {
    delete settings.statusLine;

    return settings;
  }

  const cmd = statusLine.command as string | undefined;
  if (cmd && isPalStatuslineCommand(cmd, target)) {
    delete settings.statusLine;
  }

  return settings;
}

/**
 * The doctor's git and gh checks. Neither is required: without git, project
 * matching by remote and the update checks skip; without gh, nothing does yet.
 */

import { findBinaryOnPath } from "../../hooks/lib/which";
import { type Finding, type Fix, optional, passed, warning } from "./finding";
import { type LinuxFamily, linuxFamily, readOsRelease } from "./os-release";

interface Host {
  platform: NodeJS.Platform;
  osRelease: string;
  timeoutMs: number;
}

const GH_LINUX_DOCS = "https://github.com/cli/cli/blob/trunk/docs/install_linux.md";

const GIT_ON_LINUX: Record<LinuxFamily, string> = {
  debian: "sudo apt install git",
  fedora: "sudo dnf install git",
  arch: "sudo pacman -S git",
  alpine: "sudo apk add git",
  suse: "sudo zypper install git",
};

const GH_ON_LINUX: Partial<Record<LinuxFamily, string>> = {
  fedora: "sudo dnf install gh",
  arch: "sudo pacman -S github-cli",
};

export function gitInstallHint(platform: NodeJS.Platform, osRelease: string): Fix {
  if (platform === "win32")
    return { say: "Install git", command: "winget install Git.Git", external: true };
  if (platform === "darwin")
    return { say: "Install git", command: "brew install git", external: true };
  const family = linuxFamily(osRelease);
  return family
    ? { say: "Install git", command: GIT_ON_LINUX[family], external: true }
    : { say: "Install git with your package manager" };
}

export function ghInstallHint(platform: NodeJS.Platform, osRelease: string): Fix {
  if (platform === "win32")
    return { say: "Install gh", command: "winget install GitHub.cli", external: true };
  if (platform === "darwin")
    return { say: "Install gh", command: "brew install gh", external: true };
  const family = linuxFamily(osRelease);
  const command = family ? GH_ON_LINUX[family] : undefined;
  return command
    ? { say: "Install gh", command, external: true }
    : { say: `Install gh as described at ${GH_LINUX_DOCS}` };
}

function run(binary: string, args: string[], timeoutMs: number) {
  const result = Bun.spawnSync([binary, ...args], {
    stdout: "pipe",
    stderr: "ignore",
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    answered: !result.exitedDueToTimeout,
    ok: result.success,
    firstLine: result.stdout.toString().trim().split("\n")[0] ?? "",
  };
}

function installed(name: string, timeoutMs: number) {
  const binary = findBinaryOnPath(name);
  if (!binary) return null;
  const version = run(binary, ["--version"], timeoutMs);
  return version.ok ? { binary, version: version.firstLine } : null;
}

function gitFinding(host: Host): Finding {
  const git = installed("git", host.timeoutMs);
  if (git) return passed("git", git.version);
  return warning(
    "git.missing",
    "git not found — project matching by remote, the update check and auto-update skip without it",
    gitInstallHint(host.platform, host.osRelease)
  );
}

function ghFinding(host: Host): Finding {
  const gh = installed("gh", host.timeoutMs);
  if (!gh)
    return optional(
      "gh.missing",
      "gh — lets PAL see PR, CI and release state",
      ghInstallHint(host.platform, host.osRelease)
    );
  const auth = run(gh.binary, ["auth", "status"], host.timeoutMs);
  if (!auth.answered) return passed("gh", `${gh.version} — login not checked in time`);
  if (!auth.ok)
    return warning("gh.logged-out", `${gh.version} is not logged in`, {
      say: "Log in",
      command: "gh auth login",
      external: true,
    });
  return passed("gh", `${gh.version}, logged in`);
}

export function versionControlFindings(host: Partial<Host> = {}): Finding[] {
  const resolved: Host = {
    platform: host.platform ?? process.platform,
    osRelease: host.osRelease ?? readOsRelease(),
    timeoutMs: host.timeoutMs ?? 5000,
  };
  return [gitFinding(resolved), ghFinding(resolved)];
}

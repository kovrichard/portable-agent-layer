/**
 * The doctor's git and gh checks. Neither is required: without git, project
 * matching by remote and the update checks skip; without gh, nothing does yet.
 */

import { readFileSync } from "node:fs";
import { findBinaryOnPath } from "../hooks/lib/which";

export interface DoctorLine {
  level: "ok" | "warn" | "info";
  text: string;
}

type LinuxFamily = "debian" | "fedora" | "arch" | "alpine" | "suse";

interface Host {
  platform: NodeJS.Platform;
  osRelease: string;
  timeoutMs: number;
}

const GH_LINUX_DOCS = "https://github.com/cli/cli/blob/trunk/docs/install_linux.md";

function osReleaseIds(osRelease: string): string[] {
  const field = (key: string) =>
    osRelease.match(new RegExp(String.raw`^${key}="?([^"\n]*)"?$`, "m"))?.[1] ?? "";
  return `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/).filter(Boolean);
}

function linuxFamily(osRelease: string): LinuxFamily | null {
  const ids = osReleaseIds(osRelease);
  const families: [LinuxFamily, string[]][] = [
    ["debian", ["debian", "ubuntu"]],
    ["fedora", ["fedora", "rhel", "centos"]],
    ["arch", ["arch"]],
    ["alpine", ["alpine"]],
    ["suse", ["suse", "opensuse"]],
  ];
  return families.find(([, names]) => names.some((n) => ids.includes(n)))?.[0] ?? null;
}

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

export function gitInstallHint(platform: NodeJS.Platform, osRelease: string): string {
  if (platform === "win32") return "`winget install Git.Git`";
  if (platform === "darwin") return "`brew install git` or `xcode-select --install`";
  const family = linuxFamily(osRelease);
  return family ? `\`${GIT_ON_LINUX[family]}\`` : "install git with your package manager";
}

export function ghInstallHint(platform: NodeJS.Platform, osRelease: string): string {
  if (platform === "win32") return "`winget install GitHub.cli`";
  if (platform === "darwin") return "`brew install gh`";
  const family = linuxFamily(osRelease);
  const command = family && GH_ON_LINUX[family];
  return command ? `\`${command}\`` : `see ${GH_LINUX_DOCS}`;
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

function gitLine(host: Host): DoctorLine {
  const git = installed("git", host.timeoutMs);
  if (git) return { level: "ok", text: git.version };
  return {
    level: "warn",
    text: `git — not found; project matching by remote, the update check and auto-update skip without it. ${gitInstallHint(host.platform, host.osRelease)}`,
  };
}

function ghLine(host: Host): DoctorLine {
  const gh = installed("gh", host.timeoutMs);
  if (!gh)
    return {
      level: "info",
      text: `gh — not installed (optional; lets PAL see PR, CI and release state — ${ghInstallHint(host.platform, host.osRelease)})`,
    };
  const auth = run(gh.binary, ["auth", "status"], host.timeoutMs);
  if (!auth.answered)
    return { level: "info", text: `${gh.version} — could not check the login in time` };
  if (!auth.ok)
    return {
      level: "warn",
      text: `${gh.version} — not logged in; run \`gh auth login\``,
    };
  return { level: "ok", text: `${gh.version}, logged in` };
}

function readOsRelease(): string {
  try {
    return readFileSync("/etc/os-release", "utf-8");
  } catch {
    return "";
  }
}

export function versionControlLines(host: Partial<Host> = {}): DoctorLine[] {
  const resolved: Host = {
    platform: host.platform ?? process.platform,
    osRelease: host.osRelease ?? (process.platform === "linux" ? readOsRelease() : ""),
    timeoutMs: host.timeoutMs ?? 5000,
  };
  return [gitLine(resolved), ghLine(resolved)];
}

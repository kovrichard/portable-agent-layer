import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { resolve } from "node:path";
import { paths } from "./paths";

interface Language {
  name: string;
  commands: string[];
  versioned: boolean;
  platforms?: NodeJS.Platform[];
}

const LANGUAGES: Language[] = [
  { name: "sh", commands: ["sh"], versioned: false },
  { name: "bash", commands: ["bash"], versioned: true },
  { name: "zsh", commands: ["zsh"], versioned: true },
  { name: "cmd (.bat)", commands: ["cmd"], versioned: false, platforms: ["win32"] },
  {
    name: "powershell",
    commands: ["powershell"],
    versioned: false,
    platforms: ["win32"],
  },
  { name: "pwsh", commands: ["pwsh"], versioned: true },
  { name: "python", commands: ["python3", "python"], versioned: true },
  { name: "node", commands: ["node"], versioned: true },
  { name: "bun", commands: ["bun"], versioned: true },
  { name: "deno", commands: ["deno"], versioned: true },
  { name: "perl", commands: ["perl"], versioned: true },
  { name: "ruby", commands: ["ruby"], versioned: true },
  { name: "php", commands: ["php"], versioned: true },
];

export interface Probe {
  which(command: string): string | null;
  versionOutput(path: string): string | null;
}

interface FoundLanguage {
  name: string;
  version?: string;
}

export interface Environment {
  os: string;
  arch: string;
  found: FoundLanguage[];
  missing: string[];
  detectedAt: string;
}

export function versionIn(output: string): string | undefined {
  return /\d+\.\d+(\.\d+)?/.exec(output)?.[0];
}

const WINDOWS_11_FIRST_BUILD = 22000;

export function windowsName(osRelease: string): string {
  const build = Number(osRelease.split(".")[2]);
  if (!Number.isFinite(build)) return `Windows ${osRelease}`;
  const name = build >= WINDOWS_11_FIRST_BUILD ? "Windows 11" : "Windows 10";
  return `${name} (build ${build})`;
}

export function macName(
  systemVersionPlist: string | null,
  darwinRelease: string
): string {
  const version = /<key>ProductVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(
    systemVersionPlist ?? ""
  )?.[1];
  return version ? `macOS ${version}` : `macOS (Darwin ${darwinRelease})`;
}

export function linuxName(osReleaseFile: string | null, kernelRelease: string): string {
  const pretty = /^PRETTY_NAME="?([^"\n]+)"?$/m.exec(osReleaseFile ?? "")?.[1];
  const name = pretty ?? `Linux ${kernelRelease}`;
  const wsl = /microsoft/i.test(kernelRelease) ? " (WSL)" : "";
  return name + wsl;
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function osName(os: NodeJS.Platform = platform(), osRelease = release()): string {
  if (os === "win32") return windowsName(osRelease);
  if (os === "darwin")
    return macName(
      readIfPresent("/System/Library/CoreServices/SystemVersion.plist"),
      osRelease
    );
  if (os === "linux") return linuxName(readIfPresent("/etc/os-release"), osRelease);
  return `${os} ${osRelease}`;
}

function findLanguage(language: Language, probe: Probe): FoundLanguage | null {
  for (const command of language.commands) {
    const path = probe.which(command);
    if (!path) continue;
    if (!language.versioned) return { name: language.name };
    const version = versionIn(probe.versionOutput(path) ?? "");
    if (version) return { name: language.name, version };
  }
  return null;
}

export function detectLanguages(
  probe: Probe,
  os: NodeJS.Platform
): Pick<Environment, "found" | "missing"> {
  const found: FoundLanguage[] = [];
  const missing: string[] = [];
  for (const language of LANGUAGES) {
    if (language.platforms && !language.platforms.includes(os)) continue;
    const hit = findLanguage(language, probe);
    if (hit) found.push(hit);
    else missing.push(language.name);
  }
  return { found, missing };
}

const VERSION_TIMEOUT_MS = 2000;

const systemProbe: Probe = {
  which: (command) => Bun.which(command),
  versionOutput: (path) => {
    const run = Bun.spawnSync([path, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: VERSION_TIMEOUT_MS,
    });
    if (run.exitCode !== 0) return null;
    return `${run.stdout.toString()}\n${run.stderr.toString()}`;
  },
};

function detectEnvironment(probe: Probe = systemProbe, today = new Date()): Environment {
  return {
    os: osName(),
    arch: arch(),
    ...detectLanguages(probe, platform()),
    detectedAt: today.toISOString().slice(0, 10),
  };
}

export function renderEnvironment(env: Environment): string {
  const found = env.found
    .map((language) =>
      language.version ? `${language.name} ${language.version}` : language.name
    )
    .join(", ");
  const lines = [
    "## Environment",
    "",
    `Detected on ${env.detectedAt}. After installing a language, run \`pal cli env --refresh\`.`,
    "",
    `- OS: ${env.os}, ${env.arch}`,
    `- Script languages: ${found || "none found"}`,
  ];
  if (env.missing.length > 0) lines.push(`- Not found: ${env.missing.join(", ")}`);
  return `${lines.join("\n")}\n\n`;
}

export function environmentFile(): string {
  return resolve(paths.state(), "environment.json");
}

export function readEnvironment(): Environment | null {
  const file = environmentFile();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as Environment;
  } catch {
    return null;
  }
}

export function refreshEnvironment(probe: Probe = systemProbe): Environment {
  const env = detectEnvironment(probe);
  writeFileSync(environmentFile(), `${JSON.stringify(env, null, 2)}\n`, "utf-8");
  return env;
}

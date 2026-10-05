import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { isRepoMode } from "../../hooks/handlers/update-check";
import { palPkg } from "../../hooks/lib/paths";
import { findBinaryOnPath } from "../../hooks/lib/which";
import type { ToolCheck } from "./agents";
import { type Finding, type Fix, failing, optional, passed, warning } from "./finding";
import { osReleaseField, readOsRelease } from "./os-release";
import { versionControlFindings } from "./version-control";

interface PlaywrightBuild {
  version: string;
  revision: string;
}

interface BrowserHost {
  browsersPath: string;
  playwright: PlaywrightBuild | null;
  platform: NodeJS.Platform;
  arch: string;
  osRelease: string;
}

const NEWEST_UBUNTU_PLAYWRIGHT_KNOWS = 24.04;

function playwrightBrowsersPath(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  const home = homedir();
  if (process.platform === "darwin") return resolve(home, "Library/Caches/ms-playwright");
  if (process.platform === "win32") return resolve(home, "AppData/Local/ms-playwright");
  return resolve(home, ".cache/ms-playwright");
}

function installedPlaywright(): PlaywrightBuild | null {
  try {
    const pkg = Bun.resolveSync("playwright-core/package.json", palPkg());
    const { version } = JSON.parse(readFileSync(pkg, "utf-8"));
    const { browsers } = JSON.parse(
      readFileSync(resolve(dirname(pkg), "browsers.json"), "utf-8")
    );
    const shell = (browsers as { name: string; revision: string }[]).find(
      (b) => b.name === "chromium-headless-shell"
    );
    return shell ? { version, revision: shell.revision } : null;
  } catch {
    return null;
  }
}

function hasChromium(host: BrowserHost): boolean {
  if (!existsSync(host.browsersPath)) return false;
  const dirs = readdirSync(host.browsersPath);
  const revision = host.playwright?.revision;
  return revision
    ? dirs.some(
        (d) => d === `chromium_headless_shell-${revision}` || d === `chromium-${revision}`
      )
    : dirs.some((d) => d.startsWith("chromium"));
}

function playwrightPlatformOverride(host: BrowserHost): string {
  if (host.platform !== "linux") return "";
  if (osReleaseField(host.osRelease, "ID") !== "ubuntu") return "";
  const version = Number.parseFloat(osReleaseField(host.osRelease, "VERSION_ID"));
  if (!(version > NEWEST_UBUNTU_PLAYWRIGHT_KNOWS)) return "";
  return `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-${host.arch === "arm64" ? "arm64" : "x64"} `;
}

function chromiumInstallCommand(host: BrowserHost): string {
  const pinned = host.playwright ? `playwright@${host.playwright.version}` : "playwright";
  return `${playwrightPlatformOverride(host)}bun x ${pinned} install chromium`;
}

export function playwrightFinding(host: BrowserHost): Finding {
  if (hasChromium(host)) return passed("playwright", "Playwright Chromium installed");
  return warning(
    "playwright.missing",
    "Playwright's Chromium is not installed — create-pdf, consulting-report and screenshots fail",
    {
      say: playwrightPlatformOverride(host)
        ? "Install it as Ubuntu 24.04, which Playwright supports"
        : "Install it",
      command: chromiumInstallCommand(host),
      external: false,
    }
  );
}

function thisBrowserHost(): BrowserHost {
  return {
    browsersPath: playwrightBrowsersPath(),
    playwright: installedPlaywright(),
    platform: process.platform,
    arch: process.arch,
    osRelease: readOsRelease(),
  };
}

function runInShell(command: string): boolean {
  return spawnSync(command, { cwd: palPkg(), shell: true, stdio: "ignore" }).status === 0;
}

/** A failure is left to the doctor's report that follows, which names the fix. */
export function installChromium(
  host: BrowserHost = thisBrowserHost(),
  run: (command: string) => boolean = runInShell
): void {
  if (!hasChromium(host)) run(chromiumInstallCommand(host));
}

interface PalInstall {
  pal: string | null;
  pkg: string;
  repoMode: boolean;
  bunBin: string;
  inBunBin: boolean;
}

function putPalOnPath(install: PalInstall): Fix {
  if (install.inBunBin)
    return {
      say: `Add ${install.bunBin} to PATH in your shell profile — Bun put pal there`,
    };
  return install.repoMode
    ? {
        say: "Link the checkout — a shell alias is invisible to agents",
        command: `cd ${install.pkg} && bun link`,
        external: false,
      }
    : {
        say: "Install PAL globally",
        command: "bun add -g portable-agent-layer",
        external: true,
      };
}

function bunBin(): string {
  return resolve(process.env.BUN_INSTALL ?? resolve(homedir(), ".bun"), "bin");
}

function isInBunBin(): boolean {
  return ["pal", "pal.exe"].some((name) => existsSync(resolve(bunBin(), name)));
}

export function palOnPathFinding(install: PalInstall): Finding {
  return install.pal
    ? passed("pal.path", `pal on PATH — ${install.pal}`)
    : failing(
        "pal.path",
        "pal is not on PATH — skills that run 'pal cli …' fail",
        putPalOnPath(install)
      );
}

function rtkInstall(): Fix {
  if (process.platform === "win32")
    return {
      say: "Download rtk.exe from https://github.com/rtk-ai/rtk/releases and add it to PATH",
    };
  if (process.platform === "darwin")
    return { say: "Install rtk", command: "brew install rtk", external: true };
  return {
    say: "Install rtk",
    command:
      "curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh",
    external: true,
  };
}

function rtkFinding(rtk: ToolCheck): Finding {
  return rtk.available
    ? passed("rtk", rtk.version || "rtk")
    : optional("rtk.missing", "rtk — compresses long command output", rtkInstall());
}

export function environmentFindings(rtk: ToolCheck): Finding[] {
  return [
    passed("bun", `Bun ${Bun.version}`),
    palOnPathFinding({
      pal: findBinaryOnPath("pal"),
      pkg: palPkg(),
      repoMode: isRepoMode(),
      bunBin: bunBin(),
      inBunBin: isInBunBin(),
    }),
    playwrightFinding(thisBrowserHost()),
    rtkFinding(rtk),
    ...versionControlFindings(),
  ];
}

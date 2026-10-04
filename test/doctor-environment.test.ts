import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { palOnPathFinding, playwrightFinding } from "../src/cli/doctor/environment";

let CACHE: string;

beforeEach(() => {
  CACHE = mkdtempSync(resolve(tmpdir(), "pal-doctor-pw-"));
});

afterEach(() => {
  rmSync(CACHE, { recursive: true, force: true });
});

const ubuntu = (version: string) =>
  `ID=ubuntu\nID_LIKE=debian\nVERSION_ID="${version}"\n`;

function host(overrides: Partial<Parameters<typeof playwrightFinding>[0]> = {}) {
  return {
    browsersPath: CACHE,
    playwright: { version: "1.60.0", revision: "1223" },
    platform: "linux" as NodeJS.Platform,
    arch: "x64",
    osRelease: ubuntu("24.04"),
    ...overrides,
  };
}

describe("the browser PDF and screenshot skills use", () => {
  test("the revision PAL's Playwright needs passes", () => {
    mkdirSync(resolve(CACHE, "chromium_headless_shell-1223"));

    expect(playwrightFinding(host()).severity).toBe("ok");
  });

  test("an older revision alone does not count", () => {
    mkdirSync(resolve(CACHE, "chromium-1100"));

    const finding = playwrightFinding(host());
    expect(finding.severity).toBe("warn");
    expect(finding.fix?.command).toBe("bun x playwright@1.60.0 install chromium");
  });

  test("on an Ubuntu newer than Playwright knows, the fix overrides the platform", () => {
    const finding = playwrightFinding(host({ osRelease: ubuntu("26.04") }));

    expect(finding.fix?.command).toBe(
      "PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 bun x playwright@1.60.0 install chromium"
    );
  });

  test("the override names the machine's architecture", () => {
    const finding = playwrightFinding(
      host({ osRelease: ubuntu("26.04"), arch: "arm64" })
    );

    expect(finding.fix?.command).toContain("ubuntu24.04-arm64");
  });

  test("a supported Ubuntu gets the plain command", () => {
    expect(playwrightFinding(host({ osRelease: ubuntu("22.04") })).fix?.command).toBe(
      "bun x playwright@1.60.0 install chromium"
    );
  });

  test("without a known revision, any Chromium counts", () => {
    mkdirSync(resolve(CACHE, "chromium-1100"));

    expect(playwrightFinding(host({ playwright: null })).severity).toBe("ok");
  });
});

describe("pal on PATH", () => {
  test("a repo checkout is linked, not installed from npm", () => {
    const finding = palOnPathFinding({ pal: null, pkg: "/src/pal", repoMode: true });

    expect(finding.severity).toBe("fail");
    expect(finding.fix?.command).toBe("cd /src/pal && bun link");
  });

  test("a package install is reinstalled globally", () => {
    expect(
      palOnPathFinding({ pal: null, pkg: "/g/pal", repoMode: false }).fix?.command
    ).toBe("bun add -g portable-agent-layer");
  });

  test("found on PATH passes", () => {
    expect(
      palOnPathFinding({ pal: "/bin/pal", pkg: "/g/pal", repoMode: true }).severity
    ).toBe("ok");
  });
});

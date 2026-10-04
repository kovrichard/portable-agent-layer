import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import {
  ghInstallHint,
  gitInstallHint,
  versionControlFindings,
} from "../src/cli/doctor/version-control";
import { detectRemote } from "../src/hooks/lib/remote";
import { writeFakeBin } from "./fixtures/fake-bin";

const osRelease = (id: string, like = "") =>
  `NAME="Some Linux"\nID=${id}\n${like ? `ID_LIKE="${like}"\n` : ""}`;

describe("how to install git", () => {
  test.each([
    ["win32", "", "winget install Git.Git"],
    ["darwin", "", "brew install git"],
    ["linux", osRelease("ubuntu", "debian"), "sudo apt install git"],
    ["linux", osRelease("rocky", "rhel centos fedora"), "sudo dnf install git"],
    ["linux", osRelease("arch"), "sudo pacman -S git"],
    ["linux", osRelease("alpine"), "sudo apk add git"],
    [
      "linux",
      osRelease("opensuse-tumbleweed", "opensuse suse"),
      "sudo zypper install git",
    ],
  ] as const)("%s %s", (platform, release, command) => {
    expect(gitInstallHint(platform, release).command).toBe(command);
  });

  test("an unknown Linux points at its package manager", () => {
    expect(gitInstallHint("linux", osRelease("someos")).say).toContain("package manager");
  });
});

describe("how to install gh", () => {
  test.each([
    ["win32", "", "winget install GitHub.cli"],
    ["darwin", "", "brew install gh"],
    ["linux", osRelease("fedora"), "sudo dnf install gh"],
    ["linux", osRelease("arch"), "sudo pacman -S github-cli"],
    [
      "linux",
      osRelease("ubuntu", "debian"),
      "https://github.com/cli/cli/blob/trunk/docs/install_linux.md",
    ],
  ] as const)("%s %s", (platform, release, command) => {
    const hint = ghInstallHint(platform, release);
    expect(hint.command ?? hint.say).toContain(command);
  });
});

describe("checking git and gh", () => {
  let bin: string;
  let savedPath: string | undefined;

  beforeEach(() => {
    bin = mkdtempSync(resolve(tmpdir(), "pal-doctor-vc-"));
    savedPath = process.env.PATH;
    process.env.PATH = [bin, dirname(process.execPath)].join(delimiter);
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    rmSync(bin, { recursive: true, force: true });
  });

  const fakeGit = () => writeFakeBin(bin, "git", 'console.log("git version 2.50.0");');
  const fakeGh = (authExit: number, hang = false) =>
    writeFakeBin(
      bin,
      "gh",
      `if (Bun.argv[2] === "--version") { console.log("gh version 2.80.0"); process.exit(0); }
${hang ? "await Bun.sleep(10_000);" : ""}
process.exit(${authExit});`
    );
  const findings = () =>
    versionControlFindings({ platform: "darwin", osRelease: "", timeoutMs: 3000 });

  test("no git warns, names what stops working, and says how to install it", () => {
    const [git] = findings();

    expect(git.severity).toBe("warn");
    expect(git.title).toContain("project matching");
    expect(git.fix?.command).toBe("brew install git");
  });

  test("git present passes with its version", () => {
    fakeGit();

    expect(findings()[0]).toEqual({
      id: "git",
      severity: "ok",
      title: "git version 2.50.0",
    });
  });

  test("no gh is listed as optional, with the install command", () => {
    const gh = findings()[1];

    expect(gh.severity).toBe("optional");
    expect(gh.fix?.command).toBe("brew install gh");
  });

  test("gh logged in passes", () => {
    fakeGh(0);

    expect(findings()[1].title).toBe("gh version 2.80.0, logged in");
    expect(findings()[1].severity).toBe("ok");
  });

  test("gh logged out warns to log in", () => {
    fakeGh(1);

    const gh = findings()[1];
    expect(gh.severity).toBe("warn");
    expect(gh.fix?.command).toBe("gh auth login");
  });

  test("a gh that does not answer is not reported as logged out", () => {
    fakeGh(1, true);

    const gh = versionControlFindings({
      platform: "darwin",
      osRelease: "",
      timeoutMs: 1000,
    })[1];
    expect(gh.severity).toBe("ok");
    expect(gh.title).toContain("not checked in time");
  });

  test("project matching by remote skips quietly without git", () => {
    expect(detectRemote(bin)).toBeNull();
  });
});

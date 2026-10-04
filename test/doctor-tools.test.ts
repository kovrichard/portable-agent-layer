import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import {
  ghInstallHint,
  gitInstallHint,
  versionControlLines,
} from "../src/cli/doctor-tools";
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
    expect(gitInstallHint(platform, release)).toContain(command);
  });

  test("an unknown Linux points at its package manager", () => {
    expect(gitInstallHint("linux", osRelease("someos"))).toContain("package manager");
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
    expect(ghInstallHint(platform, release)).toContain(command);
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
  const lines = () =>
    versionControlLines({ platform: "darwin", osRelease: "", timeoutMs: 3000 });

  test("no git warns and names what stops working", () => {
    const [git] = lines();

    expect(git.level).toBe("warn");
    expect(git.text).toContain("project matching");
    expect(git.text).toContain("brew install git");
  });

  test("git present is ok with its version", () => {
    fakeGit();

    expect(lines()[0]).toEqual({ level: "ok", text: "git version 2.50.0" });
  });

  test("no gh is an optional note with the install command", () => {
    const gh = lines()[1];

    expect(gh.level).toBe("info");
    expect(gh.text).toContain("optional");
    expect(gh.text).toContain("brew install gh");
  });

  test("gh logged in is ok", () => {
    fakeGh(0);

    expect(lines()[1]).toEqual({ level: "ok", text: "gh version 2.80.0, logged in" });
  });

  test("gh logged out warns to log in", () => {
    fakeGh(1);

    const gh = lines()[1];
    expect(gh.level).toBe("warn");
    expect(gh.text).toContain("gh auth login");
  });

  test("a gh that does not answer is not reported as logged out", () => {
    fakeGh(1, true);

    const gh = versionControlLines({
      platform: "darwin",
      osRelease: "",
      timeoutMs: 1000,
    })[1];
    expect(gh.level).toBe("info");
    expect(gh.text).toContain("could not check");
  });

  test("project matching by remote skips quietly without git", () => {
    expect(detectRemote(bin)).toBeNull();
  });
});

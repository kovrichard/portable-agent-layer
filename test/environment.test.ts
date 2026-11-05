import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch } from "node:os";
import { resolve } from "node:path";
import { currentEnvironment } from "../src/cli/env";
import {
  detectEnvironment,
  detectLanguages,
  type Environment,
  environmentFile,
  linuxName,
  macName,
  osName,
  type Probe,
  readEnvironment,
  refreshEnvironment,
  renderEnvironment,
  versionIn,
  windowsName,
} from "../src/hooks/lib/environment";
import { platform as palPlatform } from "../src/hooks/lib/paths";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const TEST_HOME = testHome(import.meta.file);

beforeAll(() => {
  removeOnceReleased(TEST_HOME);
  mkdirSync(resolve(TEST_HOME, "memory", "state"), { recursive: true });
  process.env.PAL_HOME = TEST_HOME;
});

const EVERY_COMMAND = [
  "sh",
  "bash",
  "zsh",
  "cmd",
  "powershell",
  "pwsh",
  "python3",
  "node",
  "bun",
  "deno",
  "perl",
  "ruby",
  "php",
];

function everyCommandProbe(): Probe {
  return {
    which: (command) => `/bin/${command}`,
    versionOutput: (path) => `${path.replace("/bin/", "")} 1.${path.length}.0`,
  };
}

function fakeProbe(installed: Record<string, string | null>): Probe {
  return {
    which: (command) => (command in installed ? `/bin/${command}` : null),
    versionOutput: (path) => installed[path.replace("/bin/", "")] ?? null,
  };
}

describe("OS name", () => {
  test("Windows build 22000 and later is Windows 11", () => {
    expect(windowsName("10.0.22631")).toBe("Windows 11 (build 22631)");
    expect(windowsName("10.0.22000")).toBe("Windows 11 (build 22000)");
  });

  test("Windows builds before 22000 are Windows 10", () => {
    expect(windowsName("10.0.19045")).toBe("Windows 10 (build 19045)");
  });

  test("a Windows release without a build number is shown as it is", () => {
    expect(windowsName("10.0")).toBe("Windows 10.0");
  });

  test("osName reads each platform's own version file", () => {
    const files: Record<string, string> = {
      "/System/Library/CoreServices/SystemVersion.plist":
        "<key>ProductVersion</key><string>15.1</string>",
      "/etc/os-release": "PRETTY_NAME=Fedora Linux 41",
    };
    const read = (path: string) => files[path] ?? null;
    expect(osName("win32", "10.0.26100", read)).toBe("Windows 11 (build 26100)");
    expect(osName("darwin", "24.1.0", read)).toBe("macOS 15.1");
    expect(osName("linux", "6.11.4", read)).toBe("Fedora Linux 41");
    expect(osName("freebsd", "14.1-RELEASE", read)).toBe("freebsd 14.1-RELEASE");
  });

  test("osName on this machine names a real OS", () => {
    expect(osName()).not.toBe("");
    expect(osName()).not.toContain("undefined");
  });

  test("macOS reads the product version from SystemVersion.plist", () => {
    const plist =
      "<key>ProductName</key>\n<string>macOS</string>\n<key>ProductVersion</key>\n\t<string>15.1</string>";
    expect(macName(plist, "24.1.0")).toBe("macOS 15.1");
    expect(macName(null, "24.1.0")).toBe("macOS (Darwin 24.1.0)");
  });

  test("Linux uses PRETTY_NAME and marks WSL", () => {
    const osRelease = 'NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04 LTS"\nID=ubuntu\n';
    expect(linuxName(osRelease, "6.8.0-45-generic")).toBe("Ubuntu 24.04 LTS");
    expect(linuxName(osRelease, "5.15.153.1-microsoft-standard-WSL2")).toBe(
      "Ubuntu 24.04 LTS (WSL)"
    );
    expect(linuxName(null, "6.8.0")).toBe("Linux 6.8.0");
    expect(linuxName("PRETTY_NAME=Arch Linux\n", "6.6.36-Microsoft")).toBe(
      "Arch Linux (WSL)"
    );
  });
});

describe("script languages", () => {
  test("a version is the first dotted number in the output", () => {
    expect(versionIn("Python 3.12.1")).toBe("3.12.1");
    expect(versionIn("This is perl 5, version 40, subversion 1 (v5.40.1)")).toBe(
      "5.40.1"
    );
    expect(versionIn("GNU bash, version 5.3.9(1)-release")).toBe("5.3.9");
    expect(versionIn("no version here")).toBeUndefined();
    expect(versionIn("deno 2.1")).toBe("2.1");
    expect(versionIn("v24.18.0\n")).toBe("24.18.0");
  });

  test("on Windows every language is looked up, each with its own version", () => {
    const { found, missing } = detectLanguages(everyCommandProbe(), "win32");
    expect(missing).toEqual([]);
    expect(found).toEqual([
      { name: "sh" },
      { name: "bash", version: "1.9.0" },
      { name: "zsh", version: "1.8.0" },
      { name: "cmd (.bat)" },
      { name: "powershell" },
      { name: "pwsh", version: "1.9.0" },
      { name: "python", version: "1.12.0" },
      { name: "node", version: "1.9.0" },
      { name: "bun", version: "1.8.0" },
      { name: "deno", version: "1.9.0" },
      { name: "perl", version: "1.9.0" },
      { name: "ruby", version: "1.9.0" },
      { name: "php", version: "1.8.0" },
    ]);
    expect(EVERY_COMMAND).toHaveLength(found.length);
  });

  test("on Linux with nothing installed every portable language is missing", () => {
    expect(detectLanguages(fakeProbe({}), "linux")).toEqual({
      found: [],
      missing: [
        "sh",
        "bash",
        "zsh",
        "pwsh",
        "python",
        "node",
        "bun",
        "deno",
        "perl",
        "ruby",
        "php",
      ],
    });
  });

  test("python falls back to the python command when python3 is absent", () => {
    const { found } = detectLanguages(fakeProbe({ python: "Python 3.11.9" }), "win32");
    expect(found).toContainEqual({ name: "python", version: "3.11.9" });
  });

  test("a command on PATH that prints no version is not found", () => {
    const { found, missing } = detectLanguages(fakeProbe({ python: null }), "win32");
    expect(found.map((language) => language.name)).not.toContain("python");
    expect(missing).toContain("python");
  });

  test("python3 is tried before python", () => {
    const probe = fakeProbe({ python3: "Python 3.12.1", python: "Python 2.7.18" });
    const { found } = detectLanguages(probe, "linux");
    expect(found).toContainEqual({ name: "python", version: "3.12.1" });
  });

  test("a shell without a version flag counts by presence alone", () => {
    const { found } = detectLanguages(fakeProbe({ sh: null }), "linux");
    expect(found).toContainEqual({ name: "sh" });
  });

  test("Windows-only languages are listed only on Windows", () => {
    const onLinux = detectLanguages(fakeProbe({}), "linux");
    const onWindows = detectLanguages(fakeProbe({ cmd: null }), "win32");
    expect([...onLinux.missing, ...onLinux.found.map((l) => l.name)]).not.toContain(
      "cmd (.bat)"
    );
    expect(onWindows.found).toContainEqual({ name: "cmd (.bat)" });
  });
});

describe("rendered block", () => {
  const env: Environment = {
    os: "Windows 11 (build 22631)",
    arch: "x64",
    found: [{ name: "cmd (.bat)" }, { name: "python", version: "3.12.1" }],
    missing: ["bash", "perl"],
    detectedAt: "2026-11-05",
  };

  test("names the OS, the languages with versions, and what is missing", () => {
    const block = renderEnvironment(env);
    expect(block).toContain("- OS: Windows 11 (build 22631), x64");
    expect(block).toContain("- Script languages: cmd (.bat), python 3.12.1");
    expect(block).toContain("- Not found: bash, perl");
    expect(block).toContain("Detected on 2026-11-05");
    expect(block).toContain("pal cli env --refresh");
  });

  test("leaves out the missing line when everything was found", () => {
    expect(renderEnvironment({ ...env, missing: [] })).not.toContain("Not found");
  });

  test("renders the whole block as a section that ends in a blank line", () => {
    expect(renderEnvironment(env)).toBe(
      [
        "## Environment",
        "",
        "Detected on 2026-11-05. After installing a language, run `pal cli env --refresh`.",
        "",
        "- OS: Windows 11 (build 22631), x64",
        "- Script languages: cmd (.bat), python 3.12.1",
        "- Not found: bash, perl",
        "",
        "",
      ].join("\n")
    );
  });

  test("says so when no language was found", () => {
    expect(renderEnvironment({ ...env, found: [] })).toContain(
      "- Script languages: none found\n"
    );
  });
});

describe("detected environment on disk", () => {
  const day = new Date("2026-11-05T10:00:00Z");

  test("detection records this machine's OS and arch, the probe's languages and the day", () => {
    const env = detectEnvironment(fakeProbe({ sh: null }), day);
    expect(env.os).toBe(osName());
    expect(env.arch).toBe(arch());
    expect(env.found).toContainEqual({ name: "sh" });
    expect(env.detectedAt).toBe("2026-11-05");
  });

  test("nothing detected yet reads as null, and so does a corrupt file", () => {
    removeOnceReleased(environmentFile());
    expect(readEnvironment()).toBeNull();
    writeFileSync(environmentFile(), "{ not json");
    expect(readEnvironment()).toBeNull();
  });

  test("a refresh writes what it detected, and reading returns it", () => {
    const env = refreshEnvironment(fakeProbe({ perl: "perl v5.40.1" }));
    expect(readEnvironment()).toEqual(env);
    expect(env.found).toContainEqual({ name: "perl", version: "5.40.1" });
  });
});

describe("pal cli env", () => {
  test("shows what install detected without detecting again", () => {
    const installed = refreshEnvironment(fakeProbe({ ruby: "ruby 3.3.0" }));
    expect(currentEnvironment(false, fakeProbe({ php: "PHP 8.3.1" }))).toEqual(installed);
  });

  test("detects when install never did", () => {
    removeOnceReleased(environmentFile());
    const env = currentEnvironment(false, fakeProbe({ php: "PHP 8.3.1" }));
    expect(env.found).toContainEqual({ name: "php", version: "8.3.1" });
    expect(readEnvironment()).toEqual(env);
  });

  test("--refresh detects again and rewrites the agents' instructions", () => {
    refreshEnvironment(fakeProbe({}));
    const env = currentEnvironment(true, fakeProbe({ deno: "deno 2.1.4" }));
    expect(readEnvironment()).toEqual(env);
    const claudeMd = readFileSync(resolve(palPlatform.claudeDir(), "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("- Script languages: deno 2.1.4\n");
  });
});

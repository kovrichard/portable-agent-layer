import { describe, expect, test } from "bun:test";
import {
  detectLanguages,
  type Environment,
  linuxName,
  macName,
  type Probe,
  renderEnvironment,
  versionIn,
  windowsName,
} from "../src/hooks/lib/environment";

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
});

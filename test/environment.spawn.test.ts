import { describe, expect, test } from "bun:test";
import { systemProbe } from "../src/hooks/lib/environment";

describe("the system probe", () => {
  test("finds a command on PATH and misses one that is not", () => {
    expect(systemProbe.which("bun")).not.toBeNull();
    expect(systemProbe.which("no-such-interpreter-pal")).toBeNull();
  });

  test("reads the version a command prints", () => {
    expect(systemProbe.versionOutput(process.execPath)).toContain(Bun.version);
  });

  test.skipIf(process.platform === "win32")(
    "a command that exits non-zero gives no version",
    () => {
      expect(systemProbe.versionOutput("/bin/false")).toBeNull();
    }
  );
});

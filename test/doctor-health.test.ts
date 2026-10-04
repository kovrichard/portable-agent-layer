import { describe, expect, test } from "bun:test";
import {
  hookErrorFindings,
  migrationFindings,
  updateFinding,
} from "../src/cli/doctor/health";
import { apiKeyFindings, leakedEnvFindings } from "../src/cli/doctor/inference";

describe("hook errors", () => {
  test("one warning per failing hook, with its count and newest message", () => {
    const findings = hookErrorFindings([
      { source: "rating", count: 3, last: "timed out" },
      { source: "agenda", count: 1, last: "bad json" },
    ]);

    expect(findings.map((f) => f.id)).toEqual([
      "hook-errors.rating",
      "hook-errors.agenda",
    ]);
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].title).toContain("3 times");
    expect(findings[0].title).toContain("timed out");
  });

  test("no errors passes", () => {
    expect(hookErrorFindings([])[0].severity).toBe("ok");
  });
});

describe("pending migrations", () => {
  test("each warns, with the command that runs it", () => {
    const [finding] = migrationFindings([
      { id: "v9-x", description: "Move the thing", detail: "2 files" },
    ]);

    expect(finding.severity).toBe("warn");
    expect(finding.title).toContain("Move the thing (2 files)");
    expect(finding.fix?.command).toBe("pal cli migrate");
  });
});

describe("a waiting update", () => {
  const cache = (available: boolean) => ({
    checkedAt: "2026-10-04T00:00:00Z",
    available,
    current: "1.0.0",
    latest: "1.0.1",
    mode: "package" as const,
  });

  test("warns with both versions and the update command", () => {
    const finding = updateFinding(cache(true));

    expect(finding.severity).toBe("warn");
    expect(finding.title).toContain("1.0.1");
    expect(finding.title).toContain("1.0.0");
    expect(finding.fix?.command).toBe("pal cli update");
  });

  test("none waiting passes", () => {
    expect(updateFinding(cache(false)).severity).toBe("ok");
    expect(updateFinding(null).severity).toBe("ok");
  });
});

describe("variables that only PAL's own subprocesses should carry", () => {
  test("a leak into the shell fails, with the command that clears it", () => {
    const findings = leakedEnvFindings({ PAL_INFERENCE_DEPTH: "2" }, "linux");

    const depth = findings.find((f) => f.id === "env.PAL_INFERENCE_DEPTH");
    expect(depth?.severity).toBe("fail");
    expect(depth?.fix?.command).toBe("unset PAL_INFERENCE_DEPTH");
  });

  test("on Windows the command is PowerShell's", () => {
    const [finding] = leakedEnvFindings({ PAL_SPAWNED_INFERENCE: "1" }, "win32").filter(
      (f) => f.severity === "fail"
    );

    expect(finding.fix?.command).toBe("Remove-Item Env:PAL_SPAWNED_INFERENCE");
  });

  test("a clean shell passes", () => {
    expect(leakedEnvFindings({}, "linux").every((f) => f.severity === "ok")).toBe(true);
  });
});

describe("API keys", () => {
  test("an unset key is optional and says what it unlocks", () => {
    const gemini = apiKeyFindings({}).find((f) => f.id === "key.PAL_GEMINI_API_KEY");

    expect(gemini?.severity).toBe("optional");
    expect(gemini?.title).toContain("YouTube");
  });

  test("a set key passes", () => {
    const gemini = apiKeyFindings({ PAL_GEMINI_API_KEY: "x" }).find(
      (f) => f.id === "key.PAL_GEMINI_API_KEY"
    );

    expect(gemini?.severity).toBe("ok");
  });
});

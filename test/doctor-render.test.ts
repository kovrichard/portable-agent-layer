import { describe, expect, test } from "bun:test";
import { failing, optional, passed, warning } from "../src/cli/doctor/finding";
import { doctorExitCode, renderReport } from "../src/cli/doctor/render";

const base = { version: "1.2.3", agents: ["claude", "codex"] };
const plain = { verbose: false, color: false };

describe("the doctor's report", () => {
  test("a healthy machine is one line", () => {
    const lines = renderReport(
      { ...base, findings: [passed("a", "A fine"), passed("b", "B fine")] },
      plain
    );

    expect(lines).toEqual(["PAL 1.2.3 · claude, codex · 2 checks passed"]);
  });

  test("shows only the problems, each with its fix, then a summary", () => {
    const lines = renderReport(
      {
        ...base,
        findings: [
          passed("a", "A fine"),
          warning("w", "Something drifted", { say: "Resync it", command: "pal cli w" }),
          failing("f", "Something broke", { say: "Repair it", command: "pal cli f" }),
        ],
      },
      plain
    );
    const text = lines.join("\n");

    expect(text).not.toContain("A fine");
    expect(text.indexOf("Something broke")).toBeLessThan(text.indexOf("drifted"));
    expect(text).toContain("✗ Something broke");
    expect(text).toContain("→ Repair it: pal cli f");
    expect(text).toContain("⚠ Something drifted");
    expect(lines.at(-1)).toBe("1 failing · 1 warning · 1 check passed");
  });

  test("lists what is not set up yet, without counting it as a problem", () => {
    const lines = renderReport(
      {
        ...base,
        findings: [
          passed("a", "A fine"),
          optional("gh", "gh — see PR and CI state", { say: "Install it", command: "x" }),
        ],
      },
      plain
    );

    expect(lines[0]).toBe("PAL 1.2.3 · claude, codex · 1 check passed");
    expect(lines).toContain("Optional — not set up:");
    expect(lines).toContain("  · gh — see PR and CI state: x");
  });

  test("--verbose shows what passed too", () => {
    const lines = renderReport(
      { ...base, findings: [passed("a", "A fine"), warning("w", "Drifted")] },
      { verbose: true, color: false }
    );

    expect(lines).toContain("  ✓ A fine");
  });

  test("says so when no agent is installed", () => {
    const lines = renderReport({ ...base, agents: [], findings: [] }, plain);

    expect(lines[0]).toContain("no agent");
  });

  test("colours only when asked", () => {
    const report = { ...base, findings: [failing("f", "Broke")] };

    expect(renderReport(report, plain).join("")).not.toContain("\x1b[");
    expect(renderReport(report, { verbose: false, color: true }).join("")).toContain(
      "\x1b[31m"
    );
  });
});

describe("the doctor's exit code", () => {
  test("is 1 when anything fails", () => {
    expect(doctorExitCode([passed("a", "ok"), failing("f", "broke")])).toBe(1);
  });

  test("is 0 for warnings and optional items", () => {
    expect(
      doctorExitCode([
        warning("w", "drifted"),
        optional("o", "extra", { say: "add it" }),
        passed("a", "ok"),
      ])
    ).toBe(0);
  });
});

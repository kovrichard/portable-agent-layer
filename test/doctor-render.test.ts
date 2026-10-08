import { describe, expect, test } from "bun:test";
import { failing, optional, passed, warning } from "../src/cli/doctor/finding";
import { doctorExitCode, renderReport, wrapSegments } from "../src/cli/doctor/render";
import { createStyle, visibleWidth } from "../src/cli/ui/style";
import type { Terminal } from "../src/cli/ui/terminal";

const base = { version: "1.2.3", agents: ["claude", "codex"] };
const pipe: Terminal = { rich: false, color: "none", unicode: true, width: 80 };
const tty: Terminal = { rich: true, color: "truecolor", unicode: true, width: 80 };
const plain = { verbose: false, style: createStyle(pipe) };
const rich = (width = 80) => ({
  verbose: false,
  style: createStyle({ ...tty, width }),
});

const broken = [
  passed("a", "A fine"),
  warning("w", "Something drifted", {
    say: "Resync it",
    command: "pal cli w",
    external: false,
  }),
  failing("f", "Something broke", {
    say: "Repair it",
    command: "pal cli f",
    external: false,
  }),
];

const unstyled = (lines: string[]) => Bun.stripANSI(lines.join("\n"));

describe("the doctor's report, piped", () => {
  test("a healthy machine is one line", () => {
    const lines = renderReport(
      { ...base, findings: [passed("a", "A fine"), passed("b", "B fine")] },
      plain
    );

    expect(lines).toEqual(["PAL 1.2.3 · claude, codex · 2 checks passed"]);
  });

  test("shows only the problems, failures first, each with its fix", () => {
    const lines = renderReport({ ...base, findings: broken }, plain);
    const text = lines.join("\n");

    expect(lines[0]).toBe(
      "PAL 1.2.3 · claude, codex · 1 failing, 1 warning, 1 check passed"
    );
    expect(text).not.toContain("A fine");
    expect(text.indexOf("Something broke")).toBeLessThan(text.indexOf("drifted"));
    expect(lines).toContain("fail Something broke -> Repair it: pal cli f");
    expect(lines).toContain("warn Something drifted -> Resync it: pal cli w");
  });

  test("lists what is not set up yet, without counting it as a problem", () => {
    const lines = renderReport(
      {
        ...base,
        findings: [
          passed("a", "A fine"),
          optional("gh", "gh — see PR and CI state", {
            say: "Install it",
            command: "x",
            external: true,
          }),
        ],
      },
      plain
    );

    expect(lines[0]).toBe("PAL 1.2.3 · claude, codex · 1 check passed");
    expect(lines).toContain("optional gh — see PR and CI state -> Install it: x");
  });

  test("--verbose shows what passed too", () => {
    const lines = renderReport(
      { ...base, findings: [passed("a", "A fine"), warning("w", "Drifted")] },
      { ...plain, verbose: true }
    );

    expect(lines).toContain("ok   A fine");
  });

  test("says so when no agent is installed", () => {
    const lines = renderReport({ ...base, agents: [], findings: [] }, plain);

    expect(lines[0]).toContain("no agent");
  });

  test("never colours", () => {
    expect(renderReport({ ...base, findings: broken }, plain).join("")).not.toContain(
      "\x1b["
    );
  });
});

describe("the doctor's report, at a terminal", () => {
  test("the badge names the worst problem", () => {
    const failingText = unstyled(renderReport({ ...base, findings: broken }, rich()));
    const warnText = unstyled(
      renderReport({ ...base, findings: broken.slice(0, 2) }, rich())
    );
    const healthy = unstyled(
      renderReport({ ...base, findings: broken.slice(0, 1) }, rich())
    );

    expect(failingText).toContain("✖ 1 FAILING");
    expect(warnText).toContain("▲ 1 WARNING");
    expect(healthy).toContain("● HEALTHY");
  });

  test("each problem is followed by its command", () => {
    const lines = unstyled(renderReport({ ...base, findings: broken }, rich())).split(
      "\n"
    );
    const at = lines.findIndex((line) => line.includes("Something broke"));

    expect(lines[at + 1].trim()).toBe("→ pal cli f");
  });

  test("ends with the count of checks and how long they took", () => {
    const lines = renderReport({ ...base, findings: broken, elapsedMs: 812 }, rich());

    expect(unstyled(lines)).toContain("1 check passed · 0.8s");
  });

  test("--verbose groups what passed", () => {
    const findings = [
      { ...passed("bun", "Bun 1.4.0"), group: "Environment" as const },
      {
        ...passed("claude.hooks", "Hooks registered", "13 hooks"),
        group: "Agents" as const,
      },
    ];
    const text = unstyled(
      renderReport({ ...base, findings }, { ...rich(), verbose: true })
    );

    expect(text).toContain("Environment\n  ✓ Bun 1.4.0");
    expect(text).toMatch(/✓ Claude Code\s+13 hooks/);
  });

  test("no line is wider than the terminal", () => {
    const long = failing("f", `Something broke ${"very ".repeat(30)}badly`, {
      say: "Repair it",
      command: `pal cli ${"fix ".repeat(20)}`,
      external: false,
    });
    for (const width of [40, 60, 100]) {
      const lines = renderReport({ ...base, findings: [long] }, rich(width));
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });
});

describe("wrapping coloured text", () => {
  test("keeps each piece's colour across the break", () => {
    const red = (text: string) => `<r>${text}</r>`;
    const lines = wrapSegments(
      [
        { text: "aaa bbb ", paint: (t) => t },
        { text: "ccc ddd", paint: red },
      ],
      8
    );

    expect(lines).toEqual(["aaa bbb", "<r>ccc ddd</r>"]);
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

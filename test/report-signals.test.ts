import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { appendEvent, eventsSince } from "../src/bronze/events";
import { reportCommandWith } from "../src/cli/report";
import { recordDoctorRun } from "../src/report/doctor-signal";
import { listSignals, recordMessageVerdict } from "../src/report/signals";
import { runCommand } from "../src/tools/lib/command";
import { freshTestDir } from "./lib/test-home";

beforeEach(() => {
  process.env.PAL_HOME = resolve(freshTestDir(import.meta.file), "home");
});

async function run(args: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const capture = (...parts: unknown[]) => {
    lines.push(parts.join(" "));
  };
  const log = spyOn(console, "log").mockImplementation(capture);
  const error = spyOn(console, "error").mockImplementation(capture);

  try {
    const code = await runCommand(
      reportCommandWith({ ids: () => ({ home: "/home/ada", words: [] }) }),
      args,
      ["pal", "cli", "report"]
    );

    return { code, out: lines.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

function doctorStreak(): void {
  for (const hours of [0, 6, 12])
    recordDoctorRun(
      [{ id: "claude-login", severity: "fail" }],
      new Date(Date.now() - (24 - hours) * 60 * 60 * 1000)
    );
}

describe("listSignals", () => {
  test("pairs each judged message with its verdict, and a doctor signal with none", () => {
    recordMessageVerdict(
      "the stop hook hangs",
      { palBug: true, surface: "stop-hook" },
      "s1"
    );
    doctorStreak();

    expect(listSignals(new Date(0))).toEqual([
      expect.objectContaining({
        trigger: "message",
        surface: "stop-hook",
        verdict: true,
        message: "the stop hook hangs",
      }),
      expect.objectContaining({
        trigger: "doctor-stays-failed",
        surface: "claude-login",
        verdict: null,
        message: null,
      }),
    ]);
  });

  test("a forgotten message is not shown, though its verdict stays", () => {
    recordMessageVerdict("private words", { palBug: false, surface: "" });
    const [signal] = eventsSince("pal_bug_signal", new Date(0));
    appendEvent("forgotten", { target: signal.id, undone: false });

    expect(listSignals(new Date(0))).toEqual([
      expect.objectContaining({ verdict: false, message: null }),
    ]);
  });
});

describe("pal cli report signals", () => {
  test("prints one line per signal, newest window by default", async () => {
    recordMessageVerdict("the stop hook hangs", { palBug: true, surface: "stop-hook" });
    recordMessageVerdict("plan the pal ui", { palBug: false, surface: "" });
    recordMessageVerdict("doctor?", null);
    doctorStreak();
    const { code, out } = await run(["signals"]);

    expect(code).toBe(0);
    expect(out).toContain('  message  bug  stop-hook  "the stop hook hangs"');
    expect(out).toContain('  message  no-bug  -  "plan the pal ui"');
    expect(out).toContain('  message  no-verdict  -  "doctor?"');
    expect(out).toContain("  doctor-stays-failed  signal  claude-login");
  });

  test("--bugs keeps only the messages judged a PAL bug", async () => {
    recordMessageVerdict("the stop hook hangs", { palBug: true, surface: "stop-hook" });
    recordMessageVerdict("plan the pal ui", { palBug: false, surface: "" });
    const { out } = await run(["signals", "--bugs"]);

    expect(out).toContain("the stop hook hangs");
    expect(out).not.toContain("plan the pal ui");
  });

  test("--since leaves out older signals, and says when there are none", async () => {
    recordMessageVerdict("the stop hook hangs", { palBug: true, surface: "stop-hook" });

    expect((await run(["signals", "--since", "2999-01-01"])).out).toBe(
      "No signals since 2999-01-01."
    );
  });

  test("a --since that is not a date is a usage error", async () => {
    const { code, out } = await run(["signals", "--since", "soon"]);

    expect(code).not.toBe(0);
    expect(out).toContain("Not a date: soon");
  });

  test("help says what the signals are for", async () => {
    const { out } = await run(["signals", "--help"]);

    expect(out).toContain(
      "Shadow signals that PAL itself may be broken (judged messages, doctor checks that stay failed), to label before any may suggest a report"
    );
    expect(out).toContain("From this date (default: the last 14 days)");
    expect(out).toContain("Only messages judged a PAL bug");
  });
});

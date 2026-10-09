import { describe, expect, test } from "bun:test";
import { createStyle } from "../src/cli/ui/style";
import type { Terminal } from "../src/cli/ui/terminal";
import { renderUsage } from "../src/cli/usage-render";
import { type UsageData, usageLines } from "../src/tools/lib/token-report";
import {
  addToTimeBuckets,
  emptyAgentUsage,
  emptyTimeBuckets,
  horizonsFrom,
} from "../src/tools/lib/usage-buckets";

const pipe: Terminal = { rich: false, color: "none", unicode: true, width: 80 };
const tty: Terminal = { rich: true, color: "truecolor", unicode: true, width: 80 };

const NOW = new Date("2026-09-06T12:00:00.000Z");

function claudeUsage() {
  const usage = emptyAgentUsage();
  const tokens = {
    input: 1_000_000,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
  };
  addToTimeBuckets(
    usage.buckets,
    "2026-08-01T00:00:00.000Z",
    "claude-opus-5",
    tokens,
    horizonsFrom(NOW)
  );
  return usage;
}

function data(more: Partial<UsageData> = {}): UsageData {
  return {
    agents: [
      { label: "Claude Code", usage: claudeUsage() },
      { label: "Codex", usage: emptyAgentUsage() },
    ],
    pal: { buckets: emptyTimeBuckets(), byModel: {}, byCaller: {} },
    rtk: { installed: false, summary: null },
    untracked: [],
    ...more,
  };
}

const unstyled = (lines: string[]) => lines.map((line) => Bun.stripANSI(line));

describe("the usage report", () => {
  test("piped, it is the plain report", () => {
    expect(renderUsage(createStyle(pipe), data())).toEqual(usageLines(data()));
  });

  test("on a terminal, it opens with the total and the agents that made a call", () => {
    const lines = unstyled(renderUsage(createStyle(tty), data()));
    expect(lines[1]).toMatch(/PAL usage {2}\$\d+\.\d{2} {2}Claude Code$/);
  });

  test("on a terminal, a window without calls fades whole", () => {
    const style = createStyle(tty);
    const lines = renderUsage(style, data());
    const today = lines.find((line) =>
      Bun.stripANSI(line).trimStart().startsWith("Today")
    );
    expect(today).toBe(style.dim(Bun.stripANSI(today as string)));
  });

  test("on a terminal, it notes the agents it cannot count", () => {
    const lines = unstyled(
      renderUsage(createStyle(tty), data({ untracked: ["Cursor"] }))
    );
    expect(lines.some((line) => line.includes("Cursor keep no token counts"))).toBe(true);
  });
});

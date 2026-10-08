import { describe, expect, test } from "bun:test";
import { banner, compactBanner } from "../src/cli/ui/banner";
import { box, healthBadge, railRow } from "../src/cli/ui/rail";
import { createStyle, homeShortened, to256, visibleWidth } from "../src/cli/ui/style";
import type { Terminal } from "../src/cli/ui/terminal";

const term = (overrides: Partial<Terminal> = {}): Terminal => ({
  rich: true,
  color: "truecolor",
  unicode: true,
  width: 80,
  ...overrides,
});
const style = (overrides: Partial<Terminal> = {}) => createStyle(term(overrides));
const text = (lines: string[]) => Bun.stripANSI(lines.join("\n"));

describe("the style", () => {
  test("paints nothing without colour", () => {
    const s = style({ color: "none" });

    expect(s.bold(s.gradient("PAL")) + s.cmd("pal") + s.dim("x")).toBe("PALpalx");
    expect(s.badge([0, 0, 0], "HEALTHY")).toBe("[HEALTHY]");
  });

  test("paints in 24-bit or the nearest of 256 colours", () => {
    expect(style().paint([34, 211, 238], "x")).toBe("\x1b[38;2;34;211;238mx\x1b[0m");
    expect(style({ color: "256" }).paint([34, 211, 238], "x")).toBe(
      "\x1b[38;5;81mx\x1b[0m"
    );
    expect(to256([0, 0, 0])).toBe(16);
    expect(to256([255, 255, 255])).toBe(231);
  });

  test("leaves empty text alone, so no stray colour codes are printed", () => {
    expect(style().dim("")).toBe("");
  });

  test("falls back to ASCII glyphs on the legacy Windows console", () => {
    const s = style({ unicode: false });

    expect([s.glyph.ok, s.glyph.fail, s.glyph.rail, s.glyph.arrow]).toEqual([
      "v",
      "x",
      "|",
      "->",
    ]);
  });

  test("shows the home directory as ~", () => {
    expect(homeShortened("/home/ada/.pal/x and /home/ada", "/home/ada")).toBe(
      "~/.pal/x and ~"
    );
    expect(homeShortened("/x", "/")).toBe("/x");
  });
});

describe("the banner", () => {
  test("shows the wordmark when there is room", () => {
    const lines = banner(style(), "1.2.3");

    expect(lines.length).toBe(8);
    expect(text(lines)).toContain("Portable Agent Layer");
    expect(text(lines)).toContain("v1.2.3");
    expect(text(lines)).toContain("Your context, in every agent.");
  });

  test("is one line on a narrow terminal or without Unicode", () => {
    for (const s of [style({ width: 63 }), style({ unicode: false })])
      expect(banner(s, "1.2.3")).toEqual(["", compactBanner(s, "1.2.3"), ""]);
    expect(Bun.stripANSI(compactBanner(style(), "1.2.3"))).toBe(
      "◆ PAL 1.2.3 · Portable Agent Layer"
    );
  });

  test("never overflows the terminal", () => {
    for (const width of [40, 63, 64, 100])
      for (const line of banner(style({ width }), "10.20.30"))
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  });
});

describe("a rail row", () => {
  test("puts the detail beside the name and the time at the end", () => {
    const [row] = railRow(style(), "ok", "Claude Code", "25 skills · 13 hooks", "0.4s");

    expect(Bun.stripANSI(row)).toMatch(
      /^✓ {2}Claude Code {2}25 skills · 13 hooks +0\.4s$/
    );
    expect(visibleWidth(row)).toBe(60);
  });

  test("moves the detail under the name when the terminal is narrow", () => {
    const rows = railRow(
      style({ width: 30 }),
      "ok",
      "Claude Code",
      "25 skills · 13 hooks",
      "0.4s"
    );

    expect(text(rows)).toBe("✓  Claude Code          0.4s\n│  25 skills · 13 hooks");
  });

  test("wraps a long detail under the name", () => {
    const rows = railRow(style({ width: 30 }), "ok", "Shared", "word ".repeat(12), "");

    expect(rows.length).toBeGreaterThan(2);
    expect(
      text(rows.slice(1))
        .split("\n")
        .every((row) => row.startsWith("│  "))
    ).toBe(true);
  });

  test("never overflows the terminal", () => {
    for (const width of [30, 44, 60, 80])
      for (const row of railRow(
        style({ width }),
        "warn",
        "Dependencies",
        "a b c ".repeat(5),
        "12.3s"
      ))
        expect(visibleWidth(row)).toBeLessThanOrEqual(width);
  });
});

describe("the health badge", () => {
  test("names the worst problem", () => {
    const s = style({ color: "none" });

    expect(healthBadge(s, { fails: 1, warns: 2 })).toBe("[1 FAILING]");
    expect(healthBadge(s, { fails: 0, warns: 2 }, true)).toBe("[▲ 2 WARNINGS]");
    expect(healthBadge(s, { fails: 0, warns: 1 })).toBe("[1 WARNING]");
    expect(healthBadge(s, { fails: 0, warns: 0 })).toBe("[HEALTHY]");
  });
});

describe("the card", () => {
  test("frames its lines evenly", () => {
    const lines = box(style(), ["short", "a much longer line"], 30);
    const widths = new Set(lines.map(visibleWidth));

    expect(widths.size).toBe(1);
    expect(text(lines)).toContain("╭──");
  });

  test("drops the frame when it would not fit", () => {
    expect(box(style({ width: 40 }), ["one", ""], 50)).toEqual(["  one", ""]);
  });
});

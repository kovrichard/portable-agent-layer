import { homedir } from "node:os";
import { detectTerminal, type Terminal } from "./terminal";

export type Rgb = readonly [number, number, number];

export const PALETTE = {
  violet: [167, 139, 250],
  indigo: [129, 140, 248],
  cyan: [34, 211, 238],
  green: [52, 211, 153],
  amber: [251, 191, 36],
  rose: [251, 113, 133],
  dim: [100, 116, 139],
  rail: [71, 85, 105],
  soft: [148, 163, 184],
  ink: [15, 23, 42],
  shade: [11, 17, 32],
} as const satisfies Record<string, Rgb>;

const UNICODE_GLYPHS = {
  ok: "✓",
  fail: "✖",
  warn: "▲",
  healthy: "●",
  info: "◇",
  ask: "◆",
  todo: "○",
  spinner: ["◐", "◓", "◑", "◒"],
  rail: "│",
  top: "┌",
  end: "└",
  arrow: "→",
  sparkle: "✦",
  dot: "·",
  dash: "—",
  box: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
};

type Glyphs = typeof UNICODE_GLYPHS;

const ASCII_GLYPHS: Glyphs = {
  ok: "v",
  fail: "x",
  warn: "!",
  healthy: "*",
  info: "*",
  ask: "*",
  todo: "o",
  spinner: ["-", "\\", "|", "/"],
  rail: "|",
  top: "+",
  end: "+",
  arrow: "->",
  sparkle: "*",
  dot: "-",
  dash: "-",
  box: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" },
};

const RESET = "\x1b[0m";

export function visibleWidth(text: string): number {
  return Bun.stringWidth(text);
}

export function mix(from: Rgb, to: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) =>
    Math.round(from[i] + (to[i] - from[i]) * t)
  ) as unknown as Rgb;
}

function cubeLevel(channel: number): number {
  return Math.round((channel / 255) * 5);
}

/** The nearest colour in the 6x6x6 cube of a 256-colour terminal. */
export function to256([r, g, b]: Rgb): number {
  return 16 + 36 * cubeLevel(r) + 6 * cubeLevel(g) + cubeLevel(b);
}

function sgr(term: Terminal, layer: 38 | 48, rgb: Rgb): string {
  if (term.color === "truecolor") return `\x1b[${layer};2;${rgb.join(";")}m`;
  return `\x1b[${layer};5;${to256(rgb)}m`;
}

export function homeShortened(text: string, home = homedir()): string {
  return home.length > 1 ? text.replaceAll(home, "~") : text;
}

export interface Style {
  term: Terminal;
  glyph: Glyphs;
  paint: (rgb: Rgb, text: string) => string;
  badge: (rgb: Rgb, text: string) => string;
  bold: (text: string) => string;
  italic: (text: string) => string;
  gradient: (text: string) => string;
  dim: (text: string) => string;
  soft: (text: string) => string;
  cmd: (text: string) => string;
}

export function createStyle(term: Terminal = detectTerminal()): Style {
  const colored = term.color !== "none";
  const wrap = (open: string, text: string) =>
    colored && text ? `${open}${text}${RESET}` : text;
  const paint = (rgb: Rgb, text: string) => wrap(sgr(term, 38, rgb), text);
  const gradientChar = (ch: string, i: number, span: number) =>
    ch === " "
      ? ch
      : `${sgr(term, 38, mix(PALETTE.violet, PALETTE.cyan, i / span))}${ch}`;
  return {
    term,
    glyph: term.unicode ? UNICODE_GLYPHS : ASCII_GLYPHS,
    paint,
    badge: (rgb, text) =>
      colored
        ? `${sgr(term, 48, rgb)}${sgr(term, 38, PALETTE.ink)}\x1b[1m ${text} ${RESET}`
        : `[${text}]`,
    bold: (text) => wrap("\x1b[1m", text),
    italic: (text) => wrap("\x1b[3m", text),
    gradient: (text) => {
      if (!colored) return text;
      const chars = [...text];
      const span = Math.max(1, chars.length - 1);
      return `${chars.map((ch, i) => gradientChar(ch, i, span)).join("")}${RESET}`;
    },
    dim: (text) => paint(PALETTE.dim, text),
    soft: (text) => paint(PALETTE.soft, text),
    cmd: (text) => paint(PALETTE.cyan, text),
  };
}

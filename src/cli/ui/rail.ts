import { PALETTE, type Style, visibleWidth } from "./style";
import { wrapWords } from "./wrap";

const RAIL_WIDTH = 60;
const NAME_WIDTH = 13;

export type Mark = "ok" | "fail" | "warn" | "info" | "ask" | "todo" | "spin";

export function mark(style: Style, kind: Mark, frame = 0): string {
  const { glyph, paint } = style;
  switch (kind) {
    case "ok":
      return paint(PALETTE.green, glyph.ok);
    case "fail":
      return paint(PALETTE.rose, glyph.fail);
    case "warn":
      return paint(PALETTE.amber, glyph.warn);
    case "info":
      return paint(PALETTE.indigo, glyph.info);
    case "ask":
      return paint(PALETTE.cyan, glyph.ask);
    case "todo":
      return style.dim(glyph.todo);
    case "spin":
      return paint(PALETTE.violet, glyph.spinner[frame % glyph.spinner.length]);
  }
}

const railGlyph = (style: Style, glyph: string) => style.paint(PALETTE.rail, glyph);

export const railTop = (style: Style, title: string) =>
  `${railGlyph(style, style.glyph.top)}  ${style.bold(title)}`;

export const railGap = (style: Style) => railGlyph(style, style.glyph.rail);

export const railNote = (style: Style, text: string) => `${railGap(style)}  ${text}`;

export const railEnd = (style: Style, text: string) =>
  `${railGlyph(style, style.glyph.end)}  ${text}`;

function padBetween(left: string, right: string, width: number): string {
  const room = width - visibleWidth(left) - visibleWidth(right);
  return right ? `${left}${" ".repeat(Math.max(2, room))}${right}` : left;
}

/** One finished step: what it did on the same line, or under the name when the terminal is too narrow. */
export function railRow(
  style: Style,
  kind: Mark,
  name: string,
  detail: string,
  time = "",
  frame = 0
): string[] {
  const head = `${mark(style, kind, frame)}  ${name.padEnd(NAME_WIDTH)}`;
  const width = Math.min(style.term.width - 2, RAIL_WIDTH);
  const wide = `${head}${style.soft(detail)}`;
  if (visibleWidth(wide) + time.length + 2 <= width)
    return [padBetween(wide, style.dim(time), width)];
  const first = padBetween(
    `${mark(style, kind, frame)}  ${name}`,
    style.dim(time),
    width
  );
  return [first, ...railNotes(style, detail, style.dim)];
}

/** Text under a step, wrapped to the terminal so the rail stays unbroken. */
export function railNotes(
  style: Style,
  text: string,
  paint: (text: string) => string,
  lead = ""
): string[] {
  const width = Math.max(10, style.term.width - 3 - visibleWidth(lead));
  const pad = " ".repeat(visibleWidth(lead));
  return wrapWords(text, width).map((chunk, i) =>
    railNote(style, `${i === 0 ? lead : pad}${paint(chunk.text)}`)
  );
}

export interface HealthCount {
  fails: number;
  warns: number;
}

export function healthBadge(
  style: Style,
  { fails, warns }: HealthCount,
  withGlyph = false
) {
  const { glyph } = style;
  const lead = (g: string) => (withGlyph ? `${g} ` : "");
  if (fails > 0) return style.badge(PALETTE.rose, `${lead(glyph.fail)}${fails} FAILING`);
  if (warns > 0)
    return style.badge(
      PALETTE.amber,
      `${lead(glyph.warn)}${warns} WARNING${warns === 1 ? "" : "S"}`
    );
  return style.badge(PALETTE.green, `${lead(glyph.healthy)}HEALTHY`);
}

/** A card when it fits; on a narrow terminal the same lines, unframed. */
export function box(style: Style, lines: string[], inner = 50): string[] {
  if (style.term.width < inner + 4) return lines.map((line) => `  ${line}`.trimEnd());
  const { box: b } = style.glyph;
  const edge = (text: string) => railGlyph(style, text);
  const padded = (line: string) =>
    `${line}${" ".repeat(Math.max(0, inner - 2 - visibleWidth(line)))}`;
  return [
    edge(`  ${b.tl}${b.h.repeat(inner)}${b.tr}`),
    ...lines.map((line) => `  ${edge(b.v)}  ${padded(line)}${edge(b.v)}`),
    edge(`  ${b.bl}${b.h.repeat(inner)}${b.br}`),
  ];
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

import { mix, PALETTE, type Style } from "./style";

const WORDMARK = [
  "██████╗  █████╗ ██╗     ",
  "██╔══██╗██╔══██╗██║     ",
  "██████╔╝███████║██║     ",
  "██╔═══╝ ██╔══██║██║     ",
  "██║     ██║  ██║███████╗",
  "╚═╝     ╚═╝  ╚═╝╚══════╝",
];

const FULL_BANNER_WIDTH = 64;
const TAGLINE = "Your context, in every agent.";

function wordmarkRow(style: Style, row: string): string {
  const chars = [...row];
  const span = chars.length - 1;
  return chars
    .map((ch, i) => {
      if (ch === " ") return ch;
      const color = mix(PALETTE.violet, PALETTE.cyan, i / span);
      return style.paint(ch === "█" ? color : mix(color, PALETTE.shade, 0.55), ch);
    })
    .join("");
}

export function compactBanner(style: Style, version: string): string {
  const mark = `${style.glyph.ask} PAL`;
  const name = `${style.glyph.dot} Portable Agent Layer`;
  return `${style.gradient(mark)} ${style.soft(version)} ${style.dim(name)}`;
}

export function banner(style: Style, version: string): string[] {
  const { term } = style;
  if (!term.unicode || term.width < FULL_BANNER_WIDTH)
    return ["", compactBanner(style, version), ""];
  const side = [
    "",
    style.bold(style.gradient("Portable Agent Layer")),
    style.soft(`v${version}`),
    style.italic(style.soft(TAGLINE)),
    "",
    "",
  ];
  return [
    "",
    ...WORDMARK.map((row, i) => `  ${wordmarkRow(style, row)}   ${side[i]}`.trimEnd()),
    "",
  ];
}

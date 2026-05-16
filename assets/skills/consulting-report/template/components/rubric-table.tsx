import type { Dimension, RubricLevel } from "@/lib/types";

// Default 5-step palette: red → orange → amber → lime → green.
// Indexed by position in the levels array (0..n-1). For an N-level rubric,
// we sample evenly across this palette.
const DEFAULT_PALETTE = [
  "#dc2626", // red
  "#ea580c", // orange
  "#d97706", // amber
  "#84cc16", // lime
  "#16a34a", // green
];

function colorForLevel(index: number, total: number, palette: string[]): string {
  if (total <= 1) return palette[palette.length - 1];
  const t = index / (total - 1); // 0..1
  const pos = t * (palette.length - 1);
  return palette[Math.round(pos)];
}

// Mix a hex color toward white by `amount` (0..1). 0.9 → soft tint.
function lighten(hex: string, amount: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const toHex = (c: number) => c.toString(16).padStart(2, "0");
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

interface RubricTableProps {
  dimension: Dimension;
  /**
   * Optional color palette (low → high) used to tint each level's row.
   * Length is independent of the number of levels — entries are sampled.
   * Defaults to a 5-step red → green ramp.
   */
  palette?: string[];
}

export function RubricTable({ dimension, palette = DEFAULT_PALETTE }: RubricTableProps) {
  const levels: RubricLevel[] = dimension.levels;
  // Sort ascending for palette indexing (low score = first color), then
  // reverse for display so the highest score sits at the top of the table.
  const ascending = [...levels].sort((a, b) => a.score - b.score);
  const sorted = [...ascending].reverse();

  return (
    <div className="my-5 break-inside-avoid">
      <table className="w-full border-separate [border-spacing:0_0.3rem] font-body text-[0.85rem]">
        <tbody>
          {sorted.map((level) => {
            const ascIndex = ascending.findIndex((l) => l.score === level.score);
            const color = colorForLevel(ascIndex, ascending.length, palette);
            const rowBg = lighten(color, 0.88);
            const leftStyle = level.highlight
              ? {
                  backgroundColor: rowBg,
                  borderTop: `2px dashed ${color}`,
                  borderBottom: `2px dashed ${color}`,
                  borderLeft: `2px dashed ${color}`,
                }
              : { backgroundColor: rowBg };
            const rightStyle = level.highlight
              ? {
                  backgroundColor: rowBg,
                  borderTop: `2px dashed ${color}`,
                  borderBottom: `2px dashed ${color}`,
                  borderRight: `2px dashed ${color}`,
                }
              : { backgroundColor: rowBg };
            return (
              <tr key={level.score}>
                <td
                  className="w-[14%] align-middle text-center px-3 py-2.5 rounded-l-md"
                  style={leftStyle}
                >
                  <div
                    className="font-sans text-2xl font-bold leading-none"
                    style={{ color }}
                  >
                    {level.score}
                  </div>
                  <div className="mt-1 font-sans text-[0.7rem] font-semibold uppercase tracking-wide text-foreground">
                    {level.label}
                  </div>
                </td>
                <td
                  className="align-middle px-4 py-2.5 rounded-r-md leading-snug text-[0.8125rem] text-foreground"
                  style={rightStyle}
                >
                  {level.anchor}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

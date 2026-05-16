import type { CSSProperties } from "react";
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
  // Pick the nearest palette entry — fine for header underline coloring.
  return palette[Math.round(pos)];
}

interface RubricTableProps {
  dimension: Dimension;
  /**
   * Optional color palette (low → high) used to color each level's header
   * underline. Length is independent of the number of levels — entries are
   * sampled. Defaults to a 5-step red → green ramp.
   */
  palette?: string[];
}

export function RubricTable({ dimension, palette = DEFAULT_PALETTE }: RubricTableProps) {
  const levels: RubricLevel[] = dimension.levels;
  // Levels are expected sorted ascending by score; sort defensively here.
  const sorted = [...levels].sort((a, b) => a.score - b.score);

  return (
    <div className="my-5 break-inside-avoid">
      <table className="w-full table-fixed border-separate [border-spacing:0.4rem] font-body text-[0.85rem]">
        <thead>
          <tr>
            {sorted.map((level, i) => {
              const color = colorForLevel(i, sorted.length, palette);
              const style: CSSProperties = {
                borderBottomColor: color,
                borderBottomWidth: "2px",
                borderBottomStyle: "solid",
              };
              return (
                <th
                  key={level.score}
                  className="text-center p-2 align-top bg-background-secondary rounded-md"
                  style={style}
                >
                  <div className="font-sans text-2xl font-bold text-primary leading-none">
                    {level.score}
                  </div>
                  <div className="mt-1 font-sans text-[0.7rem] font-semibold uppercase tracking-wide text-foreground">
                    {level.label}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            {sorted.map((level) => (
              <td
                key={level.score}
                className="p-2.5 bg-background-secondary rounded-md align-top leading-snug text-[0.8125rem]"
              >
                {level.anchor}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

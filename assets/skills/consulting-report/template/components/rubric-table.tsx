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
    <div className="rubric-table-container">
      <table className="rubric-table">
        <thead>
          <tr>
            {sorted.map((level, i) => {
              const color = colorForLevel(i, sorted.length, palette);
              const style: CSSProperties = { borderBottomColor: color };
              return (
                <th key={level.score} className="rubric-header" style={style}>
                  <div className="rubric-score">{level.score}</div>
                  <div className="rubric-label">{level.label}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            {sorted.map((level) => (
              <td key={level.score} className="rubric-anchor">
                {level.anchor}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

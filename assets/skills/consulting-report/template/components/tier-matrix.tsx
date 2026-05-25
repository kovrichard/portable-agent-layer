import type { CSSProperties } from "react";
import type { TierMatrixCellValue, TierMatrixRow } from "@/lib/types";

interface TierMatrixProps {
  columns: string[];
  rows: TierMatrixRow[];
  caption?: string;
  /** Alignment for data cells. Defaults to "center" for symbol matrices; use "left" for text-heavy tables. */
  alignCells?: "left" | "center";
  /**
   * Column sizing mode:
   * - "auto" (default): browser distributes space by content — no explicit widths applied.
   * - "capped": columnWidths[i] applied as max-width — content drives size up to the cap.
   * - "manual": columnWidths[i] applied as explicit width.
   * columnWidths is parallel to ALL columns: [0] = layer column, [1..n] = data columns.
   */
  sizing?: "auto" | "capped" | "manual";
  columnWidths?: string[];
}

function CellContent({ value }: { value: TierMatrixCellValue }) {
  if (value === "required") {
    return <span className="text-success font-bold text-base">✓</span>;
  }
  if (value === "recommended") {
    return (
      <span className="font-sans text-[0.7rem] font-semibold uppercase tracking-widest text-warning">
        rec.
      </span>
    );
  }
  if (value === false) {
    return <span className="text-muted">—</span>;
  }
  return <span>{value}</span>;
}

export function TierMatrix({
  columns,
  rows,
  caption,
  alignCells = "center",
  sizing = "auto",
  columnWidths,
}: TierMatrixProps) {
  const thClass =
    "font-sans text-[0.68rem] font-bold uppercase tracking-widest text-primary px-3 py-2 border-b-2 border-primary";
  const tdClass = "px-3 py-2 border-b border-border-subtle align-middle";
  const colHeaderAlign = alignCells === "left" ? "text-left" : "text-center";
  const cellAlign = alignCells === "left" ? "text-left" : "text-center";

  function colStyle(index: number): CSSProperties | undefined {
    const val = columnWidths?.[index];
    if (!val) return undefined;
    if (sizing === "manual") return { width: val };
    if (sizing === "capped") return { maxWidth: val };
    return undefined;
  }

  return (
    <div className="my-4">
      <table className="w-full border-collapse font-body text-[0.85rem] break-inside-avoid">
        <thead>
          <tr>
            <th className={`${thClass} text-left`} style={colStyle(0)}>
              Layer
            </th>
            {columns.map((col, i) => (
              <th
                key={col}
                className={`${thClass} ${colHeaderAlign}`}
                style={colStyle(i + 1)}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.layer}:${row.cells.join("|")}`}>
              <td
                className={`${tdClass} text-left font-sans font-medium text-foreground`}
              >
                {row.layer}
              </td>
              {row.cells.map((cell, i) => (
                <td
                  key={`${columns[i] ?? "cell"}:${String(cell)}`}
                  className={`${tdClass} ${cellAlign}`}
                >
                  <CellContent value={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {caption && <p className="text-[0.78rem] text-muted italic mt-1">{caption}</p>}
    </div>
  );
}

import type { TuningLogEntry } from "@/lib/types";

export type TuningLogColumn = {
  /** Property of `TuningLogEntry` to read for this column. */
  key: keyof TuningLogEntry;
  /** Header text shown in the table. */
  header: string;
  /** Optional className applied to all body cells in this column. */
  cellClassName?: string;
};

const defaultColumns: TuningLogColumn[] = [
  { key: "date", header: "Date", cellClassName: "tuning-date" },
  { key: "parameter", header: "Parameter" },
  { key: "oldValue", header: "Old value" },
  { key: "newValue", header: "New value" },
  { key: "rationale", header: "Rationale" },
  { key: "approver", header: "Approver" },
];

interface TuningLogProps {
  entries: TuningLogEntry[];
  /**
   * Override the default 6-column layout. Provide your own columns to add /
   * remove / reorder fields. Defaults to:
   * Date, Parameter, Old value, New value, Rationale, Approver.
   */
  columns?: TuningLogColumn[];
  /**
   * Number of empty rows to render after the entries (useful for printable
   * forms where future entries are filled in by hand). Defaults to 4.
   */
  emptyRows?: number;
}

export function TuningLog({
  entries,
  columns = defaultColumns,
  emptyRows = 4,
}: TuningLogProps) {
  return (
    <table className="tuning-log">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={String(c.key)}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, i) => (
          <tr key={`${entry.date}-${i}`}>
            {columns.map((c) => (
              <td key={String(c.key)} className={c.cellClassName}>
                {entry[c.key]}
              </td>
            ))}
          </tr>
        ))}
        {Array.from({ length: emptyRows }, (_, i) => (
          <tr key={`empty-${i}`} className="tuning-log-empty">
            <td colSpan={columns.length}>&nbsp;</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

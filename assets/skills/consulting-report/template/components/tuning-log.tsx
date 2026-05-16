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
  {
    key: "date",
    header: "Date",
    cellClassName: "font-sans text-[0.75rem] text-muted whitespace-nowrap",
  },
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
  const thClass =
    "font-sans text-[0.65rem] font-bold uppercase tracking-widest text-primary px-2 py-2 border-b-2 border-primary text-left bg-background-secondary";
  const tdClass = "px-2 py-2 border-b border-border-subtle align-top";

  return (
    <table className="w-full border-collapse my-4 font-body text-[0.82rem] break-inside-avoid">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={String(c.key)} className={thClass}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={`${entry.date}-${entry.parameter}`}>
            {columns.map((c) => (
              <td key={String(c.key)} className={`${tdClass} ${c.cellClassName ?? ""}`}>
                {entry[c.key]}
              </td>
            ))}
          </tr>
        ))}
        {Array.from({ length: emptyRows }, (_, i) => {
          const row = (
            // biome-ignore lint/suspicious/noArrayIndexKey: static padding rows, order is fixed
            <tr key={`empty-${i}`}>
              <td
                colSpan={columns.length}
                className="h-6 bg-background-secondary border-b border-border-subtle"
              >
                &nbsp;
              </td>
            </tr>
          );
          return row;
        })}
      </tbody>
    </table>
  );
}

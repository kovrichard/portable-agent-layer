import type { ConfigurationParameter } from "@/lib/types";

export type ConfigurationColumn = {
  /** Property of `ConfigurationParameter` to read for this column. */
  key: keyof ConfigurationParameter;
  /** Header text shown in the table. */
  header: string;
  /** Optional className applied to all body cells in this column. */
  cellClassName?: string;
};

const defaultColumns: ConfigurationColumn[] = [
  { key: "name", header: "Parameter", cellClassName: "font-sans font-semibold w-[28%]" },
  { key: "currentValue", header: "Current value", cellClassName: "w-[28%]" },
  {
    key: "location",
    header: "Location",
    cellClassName: "w-[18%] font-sans text-[0.78rem] text-muted",
  },
  {
    key: "rationale",
    header: "Tuning rationale",
    cellClassName: "w-[26%] text-muted text-[0.82rem] italic",
  },
];

interface ConfigurationTableProps {
  parameters: ConfigurationParameter[];
  /**
   * Override the default 4-column layout. Pass a different array of
   * columns to render any subset / superset of `ConfigurationParameter`
   * fields. Defaults to: Parameter, Current value, Location, Tuning rationale.
   */
  columns?: ConfigurationColumn[];
  /**
   * Default label for the "tunable" marker, used when a parameter does not
   * provide its own `tunableLabel`. Defaults to "TUNABLE".
   */
  defaultTunableLabel?: string;
}

const tunableClass =
  "inline-block ml-2 px-1.5 py-px bg-warning/10 text-warning font-sans text-[0.6rem] font-bold uppercase tracking-widest border border-warning/30 rounded align-middle";

export function ConfigurationTable({
  parameters,
  columns = defaultColumns,
  defaultTunableLabel = "TUNABLE",
}: ConfigurationTableProps) {
  const thClass =
    "font-sans text-[0.68rem] font-bold uppercase tracking-widest text-primary px-2.5 py-2 border-b-2 border-primary text-left";
  const tdClass = "px-2.5 py-2 border-b border-border-subtle align-top";

  return (
    <table className="w-full border-collapse my-4 font-body text-[0.85rem] break-inside-avoid">
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
        {parameters.map((p) => (
          <tr key={p.name}>
            {columns.map((c) => {
              const value = p[c.key];
              const isNameCol = c.key === "name";
              return (
                <td key={String(c.key)} className={`${tdClass} ${c.cellClassName ?? ""}`}>
                  {value ?? (c.key === "rationale" ? "—" : "")}
                  {isNameCol && p.tunable && (
                    <span className={tunableClass}>
                      {p.tunableLabel ?? defaultTunableLabel}
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

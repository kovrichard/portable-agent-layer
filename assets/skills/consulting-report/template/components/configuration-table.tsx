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
  { key: "name", header: "Parameter", cellClassName: "config-param" },
  { key: "currentValue", header: "Current value", cellClassName: "config-value" },
  { key: "location", header: "Location", cellClassName: "config-location" },
  { key: "rationale", header: "Tuning rationale", cellClassName: "config-rationale" },
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

export function ConfigurationTable({
  parameters,
  columns = defaultColumns,
  defaultTunableLabel = "TUNABLE",
}: ConfigurationTableProps) {
  return (
    <table className="configuration-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={String(c.key)}>{c.header}</th>
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
                <td key={String(c.key)} className={c.cellClassName}>
                  {value ?? (c.key === "rationale" ? "—" : "")}
                  {isNameCol && p.tunable && (
                    <span className="config-tunable">
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

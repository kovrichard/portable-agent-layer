interface ComparisonRow {
  metric: string;
  left: string;
  right: string;
}

interface ComparisonTableProps {
  leftLabel: string;
  rightLabel: string;
  rows: ComparisonRow[];
  metricLabel?: string;
}

export function ComparisonTable({
  leftLabel,
  rightLabel,
  rows,
  metricLabel = "Metric",
}: ComparisonTableProps) {
  const thClass =
    "font-sans text-[0.7rem] font-semibold uppercase tracking-widest text-primary px-4 py-3 border-b-2 border-primary text-left";
  const tdClass =
    "px-4 py-3 border-b border-border-subtle align-top last:[&:last-child]:border-b-0";
  return (
    <table className="w-full border-collapse my-6 font-body text-[0.9375rem]">
      <thead>
        <tr>
          <th className={thClass}>{metricLabel}</th>
          <th className={thClass}>{leftLabel}</th>
          <th className={thClass}>{rightLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.metric}>
            <td className={`${tdClass} font-sans font-semibold text-foreground`}>
              {row.metric}
            </td>
            <td className={tdClass}>{row.left}</td>
            <td className={tdClass}>{row.right}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

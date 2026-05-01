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
  return (
    <table className="comparison-table">
      <thead>
        <tr>
          <th>{metricLabel}</th>
          <th>{leftLabel}</th>
          <th>{rightLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.metric}>
            <td className="metric">{row.metric}</td>
            <td>{row.left}</td>
            <td>{row.right}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

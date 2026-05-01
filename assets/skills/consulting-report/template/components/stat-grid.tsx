interface Stat {
  value: string;
  label: string;
  caption?: string;
}

interface StatGridProps {
  stats: Stat[];
}

export function StatGrid({ stats }: StatGridProps) {
  return (
    <div
      className="stat-grid"
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
    >
      {stats.map((s) => (
        <div key={s.label} className="stat">
          <div className="stat-value">{s.value}</div>
          <div className="stat-label">{s.label}</div>
          {s.caption && <div className="stat-caption">{s.caption}</div>}
        </div>
      ))}
    </div>
  );
}

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
      className="grid gap-6 my-6 p-6 bg-background-secondary rounded-lg border border-border break-inside-avoid"
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
    >
      {stats.map((s) => (
        <div key={s.label} className="text-left">
          <div className="font-sans text-4xl font-bold text-primary -tracking-wider leading-none">
            {s.value}
          </div>
          <div className="mt-2 font-sans text-[0.8125rem] font-semibold text-foreground">
            {s.label}
          </div>
          {s.caption && (
            <div className="mt-1 font-body text-[0.8125rem] text-muted">{s.caption}</div>
          )}
        </div>
      ))}
    </div>
  );
}

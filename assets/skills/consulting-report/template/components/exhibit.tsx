interface ExhibitProps {
  number: number | string;
  title: string;
  source?: string;
  children: React.ReactNode;
}

export function Exhibit({ number, title, source, children }: ExhibitProps) {
  return (
    <div className="bg-background-secondary border border-border rounded-lg p-6 my-6 break-inside-avoid">
      <div className="flex justify-between items-baseline mb-4 pb-2 border-b border-border-subtle">
        <div>
          <span className="font-sans font-semibold text-primary text-sm uppercase tracking-widest">
            Exhibit {number}
          </span>
          <span className="font-heading font-semibold text-foreground ml-3">{title}</span>
        </div>
        {source && <span className="text-xs text-muted italic">Source: {source}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

interface CalloutProps {
  label?: string;
  children: React.ReactNode;
}

export function Callout({ label = "Key Takeaway", children }: CalloutProps) {
  return (
    <div className="bg-callout border-l-4 border-primary px-6 py-5 my-6 rounded-r-lg break-inside-avoid">
      <div className="font-sans font-semibold text-primary text-xs uppercase tracking-widest mb-2">
        {label}
      </div>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

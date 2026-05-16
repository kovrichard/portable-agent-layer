interface TemplateBlockProps {
  label?: string;
  children: React.ReactNode;
}

export function TemplateBlock({
  label = "Copy this template for each opportunity",
  children,
}: TemplateBlockProps) {
  return (
    <div className="border border-dashed border-border-emphasis rounded-lg p-4 my-6 bg-background-secondary break-inside-avoid">
      <div className="font-sans text-[0.68rem] font-bold uppercase tracking-widest text-primary mb-3">
        {label}
      </div>
      <pre className="font-mono text-[0.78rem] leading-relaxed text-foreground whitespace-pre-wrap break-words m-0 bg-transparent">
        <code>{children}</code>
      </pre>
    </div>
  );
}

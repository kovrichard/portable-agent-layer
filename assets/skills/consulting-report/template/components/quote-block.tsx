interface QuoteBlockProps {
  quote: string;
  attribution: string;
  role?: string;
}

export function QuoteBlock({ quote, attribution, role }: QuoteBlockProps) {
  return (
    <div
      className={[
        "relative px-8 py-6 my-6 bg-background-secondary rounded-lg",
        "border border-border-subtle break-inside-avoid",
        // Decorative opening curly-quote glyph rendered via the ::before
        // pseudo-element. Kept as utility classes to avoid a CSS file rule.
        "before:content-['\\201C'] before:absolute before:top-2 before:left-3",
        "before:text-5xl before:text-primary/50 before:leading-none",
        "before:font-[Georgia,serif]",
      ].join(" ")}
    >
      <p className="italic text-foreground text-[1.0625rem] leading-relaxed">{quote}</p>
      <p className="mt-3 text-sm text-muted">
        — {attribution}
        {role && <span className="text-muted">, {role}</span>}
      </p>
    </div>
  );
}

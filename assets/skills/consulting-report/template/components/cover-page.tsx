interface CoverPageProps {
  clientName: string;
  reportTitle: string;
  reportDate: string;
  classification: string;
  consultancyName: string;
  preTitle?: string;
}

export function CoverPage({
  clientName,
  reportTitle,
  reportDate,
  classification,
  consultancyName,
  preTitle = "Strategic Assessment",
}: CoverPageProps) {
  return (
    <div
      className={[
        "min-h-screen flex flex-col justify-center p-16",
        "break-after-page",
        "bg-gradient-to-b from-background to-background-secondary",
      ].join(" ")}
    >
      <div className="font-sans text-sm font-semibold text-destructive uppercase tracking-[0.15em] mb-16">
        {classification}
      </div>

      <div className="text-sm tracking-[0.25em] text-primary uppercase mb-4 font-semibold font-sans">
        {preTitle}
      </div>
      <h1 className="font-heading text-5xl font-semibold text-foreground leading-tight mb-4 tracking-tight">
        {reportTitle}
      </h1>
      <p className="font-heading text-2xl text-muted mb-16 font-normal">
        Prepared for {clientName}
      </p>

      <div className="mt-auto pt-6 border-t border-border">
        <p className="font-sans text-base text-muted">{reportDate}</p>
        <p className="text-muted-dark text-sm mt-2 font-sans">{consultancyName}</p>
      </div>
    </div>
  );
}

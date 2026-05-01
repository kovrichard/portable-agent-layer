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
    <div className="cover-page">
      <div className="cover-classification">{classification}</div>

      <div className="flex-1 flex flex-col justify-center">
        <div className="text-sm tracking-[0.25em] text-primary uppercase mb-4 font-semibold">
          {preTitle}
        </div>
        <h1 className="cover-title">{reportTitle}</h1>
        <p className="cover-subtitle">Prepared for {clientName}</p>
      </div>

      <div className="cover-meta">
        <p className="cover-date">{reportDate}</p>
        <p className="text-muted-dark text-sm mt-2">{consultancyName}</p>
      </div>
    </div>
  );
}

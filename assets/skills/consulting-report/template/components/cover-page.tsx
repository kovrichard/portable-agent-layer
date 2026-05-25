interface MetadataItem {
  label: string;
  value: string;
}

interface CoverPageProps {
  reportTitle: string;
  reportDate: string;
  clientName: string;
  consultancyName: string;
  preTitle?: string;
  /** Path to consultancy logo image. Falls back to consultancyName text wordmark. */
  consultancyLogoSrc?: string;
  /** Path to client logo image. Falls back to clientName text wordmark. */
  clientLogoSrc?: string;
  /** Optional metadata rows rendered in the bottom strip (e.g. classification, version). */
  metadata?: MetadataItem[];
}

function LogoSlot({
  src,
  name,
  align = "left",
}: {
  src?: string;
  name: string;
  align?: "left" | "right";
}) {
  if (src) {
    return (
      // biome-ignore lint/performance/noImgElement: Template reports are static exports; next/image is not needed for print logos.
      <img
        src={src}
        alt={name}
        className="h-10 w-auto object-contain"
        style={{ maxWidth: 180 }}
      />
    );
  }
  return (
    <span
      className={`font-sans text-sm font-bold uppercase tracking-widest text-foreground ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {name}
    </span>
  );
}

export function CoverPage({
  reportTitle,
  clientName,
  consultancyName,
  preTitle,
  consultancyLogoSrc,
  clientLogoSrc,
  metadata,
}: CoverPageProps) {
  return (
    <div className="min-h-screen flex flex-col break-after-page bg-background">
      {/* Logo strip */}
      <div className="flex items-center justify-between px-16 py-8 border-b-2 border-primary">
        <LogoSlot src={consultancyLogoSrc} name={consultancyName} align="left" />
        <LogoSlot src={clientLogoSrc} name={clientName} align="right" />
      </div>

      {/* Main content — vertically centered */}
      <div className="flex-1 flex flex-col justify-center px-16 py-20">
        {preTitle && (
          <p className="font-sans text-xs font-bold uppercase tracking-widest text-primary mb-5">
            {preTitle}
          </p>
        )}
        <h1 className="font-heading text-5xl font-semibold text-foreground leading-tight mb-6 tracking-tight max-w-2xl">
          {reportTitle}
        </h1>
        <p className="font-heading text-xl text-muted font-normal">
          Prepared for {clientName}
        </p>
      </div>

      {/* Metadata strip */}
      {metadata && metadata.length > 0 && (
        <div className="border-t border-border px-16 py-8">
          <dl
            className="grid gap-x-12 gap-y-4"
            style={{
              gridTemplateColumns: `repeat(${Math.min(metadata.length, 4)}, auto) 1fr`,
            }}
          >
            {metadata.map((item) => (
              <div key={item.label}>
                <dt className="font-sans text-[0.62rem] font-bold uppercase tracking-widest text-muted mb-1">
                  {item.label}
                </dt>
                <dd className="font-sans text-sm font-medium text-foreground">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

import type { Finding } from "@/lib/types";
import { SeverityBadge } from "./severity-badge";

interface FindingCardProps {
  finding: Finding;
  index: number;
}

export function FindingCard({ finding, index }: FindingCardProps) {
  return (
    <div className="bg-background-secondary border border-border rounded-lg p-6 mb-4 break-inside-avoid">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-4">
          <span className="text-primary font-bold font-sans text-2xl min-w-8">
            {index + 1}.
          </span>
          <span className="font-heading font-semibold text-foreground text-base">
            {finding.title}
          </span>
        </div>
        <SeverityBadge severity={finding.severity} />
      </div>
      <p className="text-foreground mb-2 ml-12">{finding.description}</p>
      <p className="text-sm text-muted mt-2 ml-12">
        <span className="font-medium text-foreground">Evidence:</span> {finding.evidence}
      </p>
      <p className="text-xs text-muted mt-2 italic ml-12">Source: {finding.source}</p>
    </div>
  );
}

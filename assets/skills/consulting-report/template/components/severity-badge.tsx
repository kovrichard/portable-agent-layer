import { cn } from "@/lib/utils";

type Severity = "critical" | "high" | "medium" | "low";

interface SeverityBadgeProps {
  severity: Severity;
}

const base =
  "inline-flex items-center px-3 py-1 rounded-full font-sans text-xs font-semibold uppercase tracking-wider border";

const severityConfig: Record<Severity, { label: string; className: string }> = {
  critical: {
    label: "Critical",
    className: "bg-destructive/10 text-destructive border-destructive/30",
  },
  high: {
    label: "High",
    className: "bg-[#ea580c]/10 text-[#ea580c] border-[#ea580c]/30",
  },
  medium: {
    label: "Medium",
    className: "bg-warning/10 text-warning border-warning/30",
  },
  low: {
    label: "Low",
    className: "bg-success/10 text-success border-success/30",
  },
};

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const config = severityConfig[severity];
  return <span className={cn(base, config.className)}>{config.label}</span>;
}

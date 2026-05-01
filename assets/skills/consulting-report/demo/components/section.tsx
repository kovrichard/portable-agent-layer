import { cn } from "@/lib/utils";

interface SectionProps {
  id?: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function Section({ id, title, children, className }: SectionProps) {
  return (
    <section id={id} className={cn("report-section", className)}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

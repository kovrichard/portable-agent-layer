import { cn } from "@/lib/utils";

interface SectionProps {
  id?: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function Section({ id, title, children, className }: SectionProps) {
  return (
    <section
      id={id}
      className={cn(
        "mb-12",
        // Each top-level Section starts on a new page in print/PDF output.
        // Harmless for the first section (already at the top of a page after
        // the TOC's break-after-page).
        "break-before-page",
        // Descendant heading styles — applies to any h2..h4 inside the
        // section body without forcing callers to repeat utility classes.
        "[&_h2]:font-heading [&_h2]:text-3xl [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mb-6 [&_h2]:pb-2 [&_h2]:border-b-2 [&_h2]:border-primary",
        "[&_h3]:font-heading [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-6 [&_h3]:mb-3",
        "[&_h4]:font-heading [&_h4]:text-lg [&_h4]:font-semibold [&_h4]:text-foreground [&_h4]:mt-4 [&_h4]:mb-2",
        className
      )}
    >
      <h2>{title}</h2>
      {children}
    </section>
  );
}

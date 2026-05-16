import type { TimelinePhase } from "@/lib/types";

interface TimelineProps {
  phases: TimelinePhase[];
}

export function Timeline({ phases }: TimelineProps) {
  return (
    <div
      className={[
        "relative pl-8",
        // Vertical gradient line down the left edge.
        "before:content-[''] before:absolute before:left-2 before:top-0 before:bottom-0",
        "before:w-[2px] before:bg-gradient-to-b before:from-primary before:to-accent",
      ].join(" ")}
    >
      {phases.map((phase) => (
        <div
          key={`${phase.phase}-${phase.title}`}
          className={[
            "relative pb-6",
            // Dot on the vertical line.
            "before:content-[''] before:absolute before:left-[-1.8125rem] before:top-2",
            "before:w-3 before:h-3 before:rounded-full before:bg-primary",
          ].join(" ")}
        >
          <div className="font-sans font-semibold text-primary text-sm uppercase tracking-widest">
            {phase.phase}
          </div>
          <div className="font-heading font-semibold text-foreground mt-1">
            {phase.title}
          </div>
          <div className="text-muted text-[0.9375rem] mt-1">{phase.description}</div>
          <div className="text-xs text-primary font-medium mt-1">{phase.duration}</div>
        </div>
      ))}
    </div>
  );
}

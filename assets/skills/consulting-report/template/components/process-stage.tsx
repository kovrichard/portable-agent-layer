import type { ProcessStage } from "@/lib/types";

interface ProcessStageProps {
  stage: ProcessStage;
}

export function ProcessStageBlock({ stage }: ProcessStageProps) {
  return (
    <div className="mb-6 break-inside-avoid">
      <div className="font-sans font-semibold text-primary text-xs uppercase tracking-widest mb-3">
        {stage.name}
      </div>
      <ol className="list-decimal list-outside ml-5 space-y-2">
        {stage.items.map((item) => (
          <li
            key={`${item.text}:${item.note ?? ""}`}
            className="text-[0.9375rem] text-foreground pl-1"
          >
            {item.text}
            {item.note && (
              <span className="ml-1 text-muted text-[0.82rem] italic">({item.note})</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

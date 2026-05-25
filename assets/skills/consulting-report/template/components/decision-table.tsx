import type { Decision } from "@/lib/types";

interface DecisionTableProps {
  decisions: Decision[];
  intro?: string;
}

function StatusBadge({ status }: { status: Decision["status"] }) {
  if (status === "adopt-default") {
    return (
      <span className="inline-block px-2 py-0.5 rounded font-sans text-[0.65rem] font-bold uppercase tracking-widest bg-success/10 text-success border border-success/30">
        Adopt default
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded font-sans text-[0.65rem] font-bold uppercase tracking-widest bg-warning/10 text-warning border border-warning/30">
      Confirm at sync
    </span>
  );
}

export function DecisionTable({ decisions, intro }: DecisionTableProps) {
  const thClass =
    "font-sans text-[0.68rem] font-bold uppercase tracking-widest text-primary px-3 py-2 border-b-2 border-primary text-left";
  const tdClass = "px-3 py-2.5 border-b border-border-subtle align-top";

  return (
    <div className="my-4">
      {intro && <p className="text-[0.9375rem] mb-4">{intro}</p>}
      <table className="w-full border-collapse font-body text-[0.85rem]">
        <thead>
          <tr>
            <th className={`${thClass} w-[4%]`}>#</th>
            <th className={`${thClass} w-[28%]`}>Decision</th>
            <th className={`${thClass} w-[44%]`}>Recommended default</th>
            <th className={`${thClass} w-[24%]`}>Status</th>
          </tr>
        </thead>
        <tbody>
          {decisions.map((d, i) => (
            <tr key={d.id} className="break-inside-avoid">
              <td className={`${tdClass} text-muted font-sans text-[0.78rem]`}>
                {i + 1}
              </td>
              <td className={tdClass}>
                <div className="font-sans font-semibold text-foreground">{d.title}</div>
                {d.description && (
                  <div className="text-muted text-[0.82rem] mt-0.5">{d.description}</div>
                )}
              </td>
              <td className={`${tdClass} text-muted`}>{d.recommendedDefault}</td>
              <td className={tdClass}>
                <StatusBadge status={d.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

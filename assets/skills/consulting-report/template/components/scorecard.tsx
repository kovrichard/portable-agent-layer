import type { Scorecard as ScorecardType } from "@/lib/types";
import { BandBadge, type BandStyle } from "./band-badge";
import { ScoreBadge } from "./score-badge";

interface ScorecardProps {
  scorecard: ScorecardType;
  /**
   * Optional band style override forwarded to BandBadge. Lets the project
   * define its own band vocabulary (e.g., "Greenlit / Investigate / Decline").
   */
  bandStyles?: Record<string, BandStyle>;
  /**
   * Maximum score on each dimension's rubric. Forwarded to ScoreBadge for
   * color mapping. Defaults to 5.
   */
  maxScore?: number;
}

type GateVerdict = ScorecardType["gates"][number]["verdict"];

const gateColor: Record<GateVerdict, string> = {
  pass: "text-success",
  fail: "text-destructive",
  flag: "text-warning",
  "n/a": "text-muted",
};

function gateLabel(verdict: GateVerdict): string {
  if (verdict === "pass") return "Pass";
  if (verdict === "fail") return "Fail";
  if (verdict === "flag") return "Flag for review";
  return "N/A";
}

const sectionLabel =
  "font-sans text-[0.68rem] font-bold uppercase tracking-widest text-primary mb-1.5";

export function Scorecard({ scorecard, bandStyles, maxScore = 5 }: ScorecardProps) {
  const maxTotal = scorecard.maxTotal ?? 20;
  const cellBase = "px-2.5 py-1.5 border-b border-border-subtle align-top";

  return (
    <div className="bg-background-secondary border border-border rounded-xl p-5 my-6 break-inside-avoid">
      {/* Header */}
      <div className="flex justify-between items-start gap-4 mb-3 pb-3 border-b border-border-subtle">
        <div className="flex items-baseline gap-2">
          <span className="font-sans text-xl font-bold text-primary">
            {scorecard.index}.
          </span>
          <span className="font-heading text-lg font-semibold text-foreground">
            {scorecard.name}
          </span>
        </div>
        <BandBadge band={scorecard.band} bandStyles={bandStyles} />
      </div>

      <p className="text-[0.95rem] text-foreground mb-4 leading-relaxed">
        <span className="font-sans text-[0.7rem] font-bold uppercase tracking-widest text-muted">
          Outcome:
        </span>{" "}
        {scorecard.outcome}
      </p>

      {/* Gates */}
      <div className="my-3">
        <div className={sectionLabel}>Pre-scoring gates</div>
        <table className="w-full border-collapse text-[0.85rem] font-body">
          <tbody>
            {scorecard.gates.map((gate) => (
              <tr key={gate.name}>
                <td className={`${cellBase} font-sans font-semibold w-[32%]`}>
                  {gate.name}
                </td>
                <td
                  className={`${cellBase} w-[18%] font-sans text-[0.78rem] font-bold uppercase tracking-wide ${gateColor[gate.verdict]}`}
                >
                  {gateLabel(gate.verdict)}
                </td>
                <td className={`${cellBase} text-muted text-[0.8125rem]`}>
                  {gate.note ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Scores */}
      <div className="my-3">
        <div className={sectionLabel}>Dimension scores</div>
        <table className="w-full border-collapse text-[0.85rem] font-body">
          <tbody>
            {scorecard.scores.map((s) => (
              <tr key={s.dimensionId}>
                <td className={`${cellBase} font-sans font-semibold w-[22%]`}>
                  {s.dimensionLabel}
                </td>
                <td className={`${cellBase} w-[8%] text-center`}>
                  <ScoreBadge score={s.score} maxScore={maxScore} />
                </td>
                <td className={`${cellBase} text-foreground leading-snug`}>
                  {s.justification}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Total row */}
      <div className="flex justify-between items-center gap-4 mt-4 mb-2 px-3 py-2 bg-background border border-border rounded-md">
        <div className="font-sans text-[0.95rem] flex items-center gap-1.5">
          Total: <strong className="text-xl text-primary">{scorecard.total}</strong> /{" "}
          {maxTotal} <span>&nbsp;→&nbsp;</span>{" "}
          <BandBadge band={scorecard.band} bandStyles={bandStyles} />
        </div>
        {scorecard.vetoTriggered && (
          <div className="font-sans font-bold text-xs uppercase tracking-wide text-destructive">
            VETO TRIGGERED: {scorecard.vetoNote}
          </div>
        )}
      </div>

      {scorecard.weightingNote && (
        <div className="text-[0.85rem] italic text-muted mt-2 px-3 py-2 bg-background border-l-[3px] border-accent rounded-r-md">
          <span className={sectionLabel}>Weighting note:</span> {scorecard.weightingNote}
        </div>
      )}

      {/* Recommendation */}
      <div className="my-3 mt-4 pt-3 border-t border-border-subtle">
        <div className={sectionLabel}>Recommendation</div>
        <p className="text-[0.9rem] leading-relaxed mt-1 mb-2.5">{scorecard.recommendation}</p>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-2 m-0 text-[0.8125rem]">
          {(
            [
              ["First action", scorecard.firstAction],
              ["Owner", scorecard.owner],
              ["Next review", scorecard.nextReview],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="font-sans text-[0.65rem] font-bold uppercase tracking-widest text-muted mb-0.5">
                {label}
              </dt>
              <dd className="m-0 text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

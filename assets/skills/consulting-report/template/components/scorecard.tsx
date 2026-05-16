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

function gateClass(verdict: ScorecardType["gates"][number]["verdict"]): string {
  if (verdict === "pass") return "gate-pass";
  if (verdict === "fail") return "gate-fail";
  if (verdict === "flag") return "gate-flag";
  return "gate-na";
}

function gateLabel(verdict: ScorecardType["gates"][number]["verdict"]): string {
  if (verdict === "pass") return "Pass";
  if (verdict === "fail") return "Fail";
  if (verdict === "flag") return "Flag for review";
  return "N/A";
}

export function Scorecard({ scorecard, bandStyles, maxScore = 5 }: ScorecardProps) {
  const maxTotal = scorecard.maxTotal ?? 20;
  return (
    <div className="scorecard">
      <div className="scorecard-header">
        <div className="scorecard-title-row">
          <span className="scorecard-index">{scorecard.index}.</span>
          <span className="scorecard-name">{scorecard.name}</span>
        </div>
        <BandBadge band={scorecard.band} bandStyles={bandStyles} />
      </div>

      <p className="scorecard-outcome">
        <span className="scorecard-label">Outcome:</span> {scorecard.outcome}
      </p>

      <div className="scorecard-block">
        <div className="scorecard-section-label">Pre-scoring gates</div>
        <table className="scorecard-gates">
          <tbody>
            {scorecard.gates.map((gate) => (
              <tr key={gate.name}>
                <td className="gate-name">{gate.name}</td>
                <td className={`gate-verdict ${gateClass(gate.verdict)}`}>
                  {gateLabel(gate.verdict)}
                </td>
                <td className="gate-note">{gate.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="scorecard-block">
        <div className="scorecard-section-label">Dimension scores</div>
        <table className="scorecard-scores">
          <tbody>
            {scorecard.scores.map((s) => (
              <tr key={s.dimensionId}>
                <td className="score-dim">{s.dimensionLabel}</td>
                <td className="score-val">
                  <ScoreBadge score={s.score} maxScore={maxScore} />
                </td>
                <td className="score-just">{s.justification}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="scorecard-total-row">
        <div className="scorecard-total">
          Total: <strong>{scorecard.total}</strong> / {maxTotal} &nbsp;→&nbsp;{" "}
          <BandBadge band={scorecard.band} bandStyles={bandStyles} />
        </div>
        {scorecard.vetoTriggered && (
          <div className="scorecard-veto">
            VETO TRIGGERED: {scorecard.vetoNote}
          </div>
        )}
      </div>

      {scorecard.weightingNote && (
        <div className="scorecard-weighting-note">
          <span className="scorecard-section-label">Weighting note:</span>{" "}
          {scorecard.weightingNote}
        </div>
      )}

      <div className="scorecard-block scorecard-recommendation">
        <div className="scorecard-section-label">Recommendation</div>
        <p className="scorecard-rec-text">{scorecard.recommendation}</p>
        <dl className="scorecard-rec-meta">
          <div>
            <dt>First action</dt>
            <dd>{scorecard.firstAction}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{scorecard.owner}</dd>
          </div>
          <div>
            <dt>Next review</dt>
            <dd>{scorecard.nextReview}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

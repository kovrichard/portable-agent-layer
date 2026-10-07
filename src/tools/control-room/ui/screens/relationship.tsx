import { useState } from "react";
import type {
  AdaptationRule,
  TriggerProof,
} from "../../../../hooks/lib/adaptation-rules";
import type { ActiveRule, PipelineCandidate, RelationshipView } from "../../relationship";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { clock } from "../format";
import { Empty, Panel, Pending } from "../frame";
import { useLoaded } from "../lib/api";
import { decideRule } from "../lib/write";

const REACTIONS = ["approved", "follow-up", "new-topic", "corrected", "repeated"];

function proofLine(proof: TriggerProof | undefined): string {
  if (!proof) return "not proven";
  return `fired on ${proof.firedCorrections}/${proof.corrections} corrections, ${proof.firedOrdinary}/${proof.ordinary} ordinary turns`;
}

function Facts({ rows }: { rows: [string, string | undefined][] }) {
  return (
    <dl className="m-0 grid grid-cols-[90px_1fr] gap-y-1.5 text-[12.5px]">
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-neutral-600">{label}</dt>
            <dd className="m-0 break-words">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function ruleFacts(rule: AdaptationRule): [string, string | undefined][] {
  return [
    ["trigger", `${rule.trigger.side} · /${rule.trigger.pattern}/i`],
    ["steering", rule.steering],
    ["check", rule.check],
    ["proof", proofLine(rule.proof)],
  ];
}

function Evidence({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="m-0 mt-2 list-disc pl-5 text-[12px] text-neutral-700">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function replacedTrigger(rule: AdaptationRule, active: ActiveRule[]): string | undefined {
  if (!rule.widens) return undefined;
  const target = active.find((r) => r.id === rule.widens);
  if (!target) return `the trigger of rule ${rule.widens}`;
  return `/${target.trigger.pattern}/i`;
}

function Draft({
  rule,
  active,
  onDecided,
}: {
  rule: AdaptationRule;
  active: ActiveRule[];
  onDecided: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = (decision: "approved" | "denied") => {
    setBusy(true);
    void decideRule(rule.id, decision).then((failure) => {
      setBusy(false);
      setError(failure);
      if (!failure) onDecided();
    });
  };
  return (
    <div className="flex flex-col gap-3 border-t border-divider py-3 first:border-t-0">
      <div className="font-heading text-[15px] font-semibold">{rule.when}</div>
      <Facts rows={[["replaces", replacedTrigger(rule, active)], ...ruleFacts(rule)]} />
      <Evidence items={rule.evidence} />
      {error && (
        <p className="border-l-2 border-alarm bg-alarm/10 px-3 py-2 text-[12px] text-alarm">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button variant="primary" disabled={busy} onClick={() => decide("approved")}>
          Approve
        </Button>
        <Button disabled={busy} onClick={() => decide("denied")}>
          Deny
        </Button>
      </div>
    </div>
  );
}

function effectLine(rule: ActiveRule): string {
  const { fired, sentBack, judged, correctedAfter } = rule.effect;
  if (fired === 0) return "has not fired yet";
  const back = rule.trigger.side === "reply" ? `, sent back ${sentBack}` : "";
  return `fired ${fired}${back} · corrected after ${correctedAfter} of ${judged} judged`;
}

function Active({ rule }: { rule: ActiveRule }) {
  return (
    <div className="flex flex-col gap-2 border-t border-divider py-3 first:border-t-0">
      <div className="font-heading text-[15px] font-semibold">{rule.when}</div>
      <Facts rows={[...ruleFacts(rule), ["effect", effectLine(rule)]]} />
    </div>
  );
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
}

function LastDays({ view }: { view: RelationshipView }) {
  const { turns } = view;
  const corrected = turns.byReaction.corrected ?? 0;
  return (
    <Panel title={`Our last ${view.windowDays} days`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {REACTIONS.map((reaction) => (
            <Badge
              key={reaction}
              variant={reaction === "corrected" ? "alarm" : "outline"}
            >
              {reaction} {turns.byReaction[reaction] ?? 0}
            </Badge>
          ))}
        </div>
        <Facts
          rows={[
            ["turns", String(turns.total)],
            ["corrected", percent(corrected, turns.total)],
            ["confirmed", String(turns.confirmedCorrections)],
          ]}
        />
        {turns.recentCorrections.length === 0 ? (
          <Empty>No confirmed correction in this window.</Empty>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[12.5px]">
            {turns.recentCorrections.map((c) => (
              <li key={c.ts} className="border-t border-divider pt-2 first:border-t-0">
                <span className="text-[11px] text-neutral-600">{clock(c.ts)}</span>
                <span className="block">{c.issue}</span>
                <span className="block text-neutral-700">“{c.message}”</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function pipelineLine(candidate: PipelineCandidate): string {
  if (candidate.verdict === "waiting")
    return `needs ${candidate.ordinaryNeeded} more ordinary turns`;
  return `failed · ${proofLine(candidate.proof)}`;
}

function Pipeline({ candidates }: { candidates: PipelineCandidate[] }) {
  return (
    <Panel title="In the pipeline">
      {candidates.length === 0 ? (
        <Empty>Nothing being proven.</Empty>
      ) : (
        candidates.map((candidate) => (
          <div
            key={candidate.id}
            className="flex flex-col gap-1 border-t border-divider py-2.5 text-[12.5px] first:border-t-0"
          >
            <span className="font-semibold">{candidate.when}</span>
            <span className="text-neutral-700">{pipelineLine(candidate)}</span>
          </div>
        ))
      )}
    </Panel>
  );
}

function Denied({ rules }: { rules: AdaptationRule[] }) {
  if (rules.length === 0) return null;
  return (
    <Panel title="Denied">
      <details className="text-[12.5px]">
        <summary className="cursor-pointer text-neutral-700">
          {rules.length} denied
        </summary>
        <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
          {rules.map((rule) => (
            <li key={rule.id}>
              {rule.when}
              <span className="block text-neutral-600">{rule.steering}</span>
            </li>
          ))}
        </ul>
      </details>
    </Panel>
  );
}

export function Relationship() {
  const [version, setVersion] = useState(0);
  const view = useLoaded<RelationshipView>(`/api/relationship?v=${version}`);
  if (view.state !== "ready") return <Pending value={view} />;
  const { drafts, active, denied, pipeline } = view.data;
  const reload = () => setVersion(version + 1);
  return (
    <div className="grid items-start gap-6 md:grid-cols-2">
      <Panel title="Waiting on you">
        {drafts.length === 0 ? (
          <Empty>No rule draft waits for a decision.</Empty>
        ) : (
          drafts.map((rule) => (
            <Draft key={rule.id} rule={rule} active={active} onDecided={reload} />
          ))
        )}
      </Panel>
      <Panel title="Active rules">
        {active.length === 0 ? (
          <Empty>No rule approved yet.</Empty>
        ) : (
          active.map((rule) => <Active key={rule.id} rule={rule} />)
        )}
      </Panel>
      <LastDays view={view.data} />
      <Pipeline candidates={pipeline} />
      <Denied rules={denied} />
    </div>
  );
}

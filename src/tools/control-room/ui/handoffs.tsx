import type { HandoffCard } from "../data";
import { age } from "./format";
import { Panel, Pending, useLoaded } from "./panel";

function titleRepeatsSentence(h: HandoffCard): boolean {
  return h.title.startsWith(h.sentence.slice(0, 24));
}

function Handoff({ h }: { h: HandoffCard }) {
  return (
    <div className="handoff">
      <div className="where">
        <span>
          <b title={h.cwd}>{h.label}</b> · {h.source}
        </span>
        <span>{age(h.ageDays)}</span>
      </div>
      <div className="sentence" title={h.handoff}>
        {h.sentence}
      </div>
      {!titleRepeatsSentence(h) && <div className="title">{h.title}</div>}
    </div>
  );
}

export function Handoffs() {
  const cards = useLoaded<HandoffCard[]>("/api/handoffs");
  return (
    <Panel index="03 · unfinished" title="Where you left off" span={5} order={2}>
      <Pending value={cards} />
      {cards.state === "ready" && cards.data.length === 0 && (
        <div className="empty">Nothing in progress. Every handoff is closed.</div>
      )}
      {cards.state === "ready" && cards.data.map((h) => <Handoff key={h.cwd} h={h} />)}
    </Panel>
  );
}

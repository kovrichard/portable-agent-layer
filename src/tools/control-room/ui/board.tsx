import type { ProjectCard } from "../data";
import { age, plural } from "./format";
import { Panel, Pending, useLoaded } from "./panel";

function reasonTone(reason: string): string {
  if (reason.startsWith("handoff")) return "amber";
  if (reason.endsWith("blocker") || reason.endsWith("blockers")) return "bad";
  return "ghost";
}

function projectTone(p: ProjectCard): string {
  if (p.asking.length > 0) return "asking";
  if (p.stale) return "quiet";
  return "";
}

function Project({ p }: { p: ProjectCard }) {
  return (
    <div className={`project ${projectTone(p)}`}>
      <div className="name" title={p.path ?? "not checked out here"}>
        {p.slug}
        <small>
          {p.status} · {age(p.ageDays)}
          {p.path ? "" : " · elsewhere"}
        </small>
      </div>
      <div className="reasons">
        {p.asking.map((r) => (
          <span key={r} className={`tag ${reasonTone(r)}`}>
            {r}
          </span>
        ))}
        {p.blockers.map((b) => (
          <span key={b} className="tag bad" title={b}>
            ⛔ {b.length > 48 ? `${b.slice(0, 48)}…` : b}
          </span>
        ))}
      </div>
      <div className="counts">
        <b>{p.openIscs}</b> open · <b>{p.sessions30d}</b> sessions/30d
        {p.lastSession && (
          <>
            {" "}
            · last <b>{p.lastSession.date}</b>
          </>
        )}
      </div>
      {p.next[0] && <div className="next">{p.next[0]}</div>}
    </div>
  );
}

export function Board() {
  const cards = useLoaded<ProjectCard[]>("/api/board");
  const asking =
    cards.state === "ready" ? cards.data.filter((c) => c.asking.length > 0) : [];
  return (
    <Panel
      index="01 · projects"
      title="Asking for you"
      span={8}
      order={0}
      aside={
        cards.state === "ready"
          ? `${plural(asking.length, "project")} of ${cards.data.length}`
          : ""
      }
    >
      <Pending value={cards} />
      {cards.state === "ready" && cards.data.length === 0 && (
        <div className="empty">No project is registered yet.</div>
      )}
      {cards.state === "ready" && (
        <div className="board">
          {cards.data.map((p) => (
            <Project key={p.slug} p={p} />
          ))}
        </div>
      )}
    </Panel>
  );
}

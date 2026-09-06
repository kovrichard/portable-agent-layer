import type { AgentsRow, AgentsView } from "../data";
import { Panel, Pending, useLoaded } from "./panel";

function Row({ r, max }: { r: AgentsRow; max: number }) {
  return (
    <tr>
      <td>
        {r.slug}
        <span className="bar">
          <i style={{ width: `${(r.actions / max) * 100}%` }} />
        </span>
      </td>
      <td className="num">{r.actions}</td>
      <td>
        <span className="runtimes">
          {Object.entries(r.runtimes).map(([runtime, n]) => (
            <span key={runtime} className="tag">
              {runtime} {n}
            </span>
          ))}
        </span>
      </td>
      <td className="num">{r.machines}</td>
      <td className="num">{r.actors}</td>
      <td className="num">{r.sessions}</td>
    </tr>
  );
}

export function Agents() {
  const view = useLoaded<AgentsView>("/api/agents");
  const max =
    view.state === "ready" ? Math.max(1, ...view.data.projects.map((p) => p.actions)) : 1;
  return (
    <Panel
      index="04 · activity"
      title="Agents at work"
      span={7}
      order={3}
      aside={view.state === "ready" ? `since ${view.data.since.slice(0, 10)}` : ""}
    >
      <Pending value={view} />
      {view.state === "ready" && view.data.projects.length === 0 && (
        <div className="empty">No recorded actions in the window.</div>
      )}
      {view.state === "ready" && view.data.projects.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>project</th>
              <th className="num">actions</th>
              <th>runtimes</th>
              <th className="num">machines</th>
              <th className="num">actors</th>
              <th className="num">sessions</th>
            </tr>
          </thead>
          <tbody>
            {view.data.projects.map((r) => (
              <Row key={r.slug} r={r} max={max} />
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

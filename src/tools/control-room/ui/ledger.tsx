import { useState } from "react";
import type { LedgerView, LedgerViewRow, PageOutcome } from "../../ledger/view";
import { PAGE_OUTCOMES } from "../../ledger/view";
import { clock, isoDay } from "./format";
import { Panel, Pending, useLoaded } from "./panel";

const DEFAULT_WINDOW_DAYS = 14;
const MAX_ROWS = 200;

function ledgerQuery(project: string, since: string, until: string): string {
  const params = new URLSearchParams();
  if (project) params.set("project", project);
  if (since) params.set("since", since);
  if (until) params.set("until", until);
  const query = params.toString();
  return query ? `/api/ledger?${query}` : "/api/ledger";
}

function Row({ r }: { r: LedgerViewRow }) {
  const [slug, ...rest] = r.target.split(" ");
  return (
    <tr>
      <td className="when">{clock(r.ts)}</td>
      <td>
        {r.actor}
        <span className="reason">
          {r.authority} · {r.runtime}
        </span>
      </td>
      <td>{r.tool}</td>
      <td className="target" title={r.target}>
        <b>{slug}</b> {rest.join(" ")}
      </td>
      <td>{r.change}</td>
      <td>
        <span className={`outcome ${r.outcome}`}>{r.outcome}</span>
        {r.reason && <span className="reason">{r.reason}</span>}
      </td>
    </tr>
  );
}

function Strip({ view }: { view: LedgerView }) {
  return (
    <div className="strip">
      <span>
        <b>{view.stats.total}</b>actions
      </span>
      <span className="refusals">
        <b>{view.stats.refusals}</b>refusals
      </span>
      {PAGE_OUTCOMES.map((o: PageOutcome) => (
        <span key={o}>
          <b>{view.stats.outcomes[o].total}</b>
          {o}
        </span>
      ))}
    </div>
  );
}

export function Ledger() {
  const [project, setProject] = useState("");
  const [since, setSince] = useState(
    isoDay(new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000))
  );
  const [until, setUntil] = useState("");
  const projects = useLoaded<{ slug: string }[]>("/api/projects");
  const view = useLoaded<LedgerView>(ledgerQuery(project, since, until));
  return (
    <Panel
      index="05 · ledger"
      title="What the agents did"
      span={12}
      order={4}
      aside={
        <span className="filters">
          <label>
            project
            <select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">all</option>
              {projects.state === "ready" &&
                projects.data.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.slug}
                  </option>
                ))}
            </select>
          </label>
          <label>
            from
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
          </label>
          <label>
            to
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        </span>
      }
    >
      <Pending value={view} />
      {view.state === "ready" && (
        <>
          <Strip view={view.data} />
          {view.data.rows.length === 0 ? (
            <div className="empty">No actions in this window.</div>
          ) : (
            <table className="ledger">
              <thead>
                <tr>
                  <th>when</th>
                  <th>actor</th>
                  <th>action</th>
                  <th>target</th>
                  <th>change</th>
                  <th>outcome</th>
                </tr>
              </thead>
              <tbody>
                {view.data.rows.slice(0, MAX_ROWS).map((r) => (
                  <Row key={r.id} r={r} />
                ))}
              </tbody>
            </table>
          )}
          {view.data.rows.length > MAX_ROWS && (
            <div className="empty">
              Newest {MAX_ROWS} of {view.data.rows.length}. Narrow the window for the
              rest.
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

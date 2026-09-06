import { Link } from "react-router";
import type { LedgerView } from "../../../ledger/view";
import type { AgentsView, HandoffCard, ProjectCard } from "../../data";
import type { Matrix, MatrixItem } from "../../matrix";
import { age, clock } from "../format";
import { Empty, Panel, Pending, Tag } from "../frame";
import { useLoaded } from "../lib/api";
import { cn } from "../lib/cn";

const RECENT_ROWS = 6;

function outcomeTone(outcome: string) {
  if (outcome === "applied") return "neutral" as const;
  if (outcome === "failed") return "outline" as const;
  return "alarm" as const;
}

function Runtimes({ view, slug }: { view: AgentsView | null; slug: string }) {
  const row = view?.projects.find((p) => p.slug === slug);
  if (!row) return <Empty>No recorded actions in the window.</Empty>;
  const max = Math.max(1, ...Object.values(row.runtimes));
  return (
    <div className="flex flex-col gap-1.5">
      {Object.entries(row.runtimes).map(([runtime, n]) => (
        <div
          key={runtime}
          className="grid grid-cols-[70px_1fr_32px] items-center gap-2 text-[12px]"
        >
          <span>{runtime}</span>
          <span className="h-1.5 bg-neutral-300">
            <span
              className="block h-1.5 bg-accent"
              style={{ width: `${(n / max) * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums text-neutral-700">{n}</span>
        </div>
      ))}
    </div>
  );
}

function RecentActions({ rows }: { rows: LedgerView["rows"] }) {
  if (rows.length === 0) return <Empty>Nothing recorded yet.</Empty>;
  return (
    <div className="flex flex-col gap-1.5">
      {rows.slice(0, RECENT_ROWS).map((r) => (
        <div key={r.id} className="grid grid-cols-[86px_1fr_auto] gap-2 text-[11.5px]">
          <span className="text-neutral-600">{clock(r.ts).slice(5)}</span>
          <span className="truncate">
            <b className="font-medium">{r.tool}</b>{" "}
            <span className="text-neutral-700">{r.target}</span>
          </span>
          <Tag tone={outcomeTone(r.outcome)}>{r.outcome}</Tag>
        </div>
      ))}
    </div>
  );
}

function Head({ card, item }: { card: ProjectCard; item: MatrixItem | undefined }) {
  return (
    <>
      <nav className="mb-1.5 text-[12px] text-neutral-600">
        <Link to="/projects" className="hover:text-accent">
          projects
        </Link>{" "}
        / {card.slug}
      </nav>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="m-0 flex items-center gap-3 text-[38px]">
            {card.slug}
            <Tag tone="neutral">{card.status}</Tag>
          </h1>
          <p className="max-w-[760px] text-[13px] text-pretty text-neutral-800">
            {item?.importantBecause ?? "no purpose on record yet"}
          </p>
        </div>
        <div className="text-right text-[11.5px] text-neutral-600">
          <div>{card.path ?? "not checked out here"}</div>
          <div>
            {card.openIscs} open · {card.sessions30d} sessions / 30d · {age(card.ageDays)}
          </div>
        </div>
      </div>
    </>
  );
}

export function ProjectDetail({ slug }: { slug: string }) {
  const board = useLoaded<ProjectCard[]>("/api/board");
  const matrix = useLoaded<Matrix>("/api/matrix");
  const handoffs = useLoaded<HandoffCard[]>("/api/handoffs");
  const agents = useLoaded<AgentsView>("/api/agents");
  const ledger = useLoaded<LedgerView>(`/api/ledger?project=${encodeURIComponent(slug)}`);

  if (board.state !== "ready") return <Pending value={board} />;
  const card = board.data.find((p) => p.slug === slug);
  if (!card) {
    return (
      <Empty>
        No project called <b>{slug}</b> is registered.
      </Empty>
    );
  }

  const all =
    matrix.state === "ready"
      ? [
          ...matrix.data.now,
          ...matrix.data.plan,
          ...matrix.data.noise,
          ...matrix.data.later,
        ]
      : [];
  const item = all.find((i) => i.kind === "project" && i.id === slug);
  const handoff =
    handoffs.state === "ready" ? handoffs.data.find((h) => h.slug === slug) : undefined;

  return (
    <section>
      <Head card={card} item={item} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-6">
          <Panel
            title="Ideal state criteria"
            aside={`${card.openIscs} open — the list itself arrives with the detail endpoint`}
          >
            <Empty>
              Counts read off the record today; the criteria themselves are not on the
              wire yet.
            </Empty>
          </Panel>
          <div className="grid gap-6 md:grid-cols-2">
            <Panel title="Next">
              {card.next.length === 0 ? (
                <Empty>nothing queued</Empty>
              ) : (
                <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-[12.5px]">
                  {card.next.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ol>
              )}
            </Panel>
            <Panel title="Blockers">
              {card.blockers.length === 0 ? (
                <Empty>none</Empty>
              ) : (
                <div className="flex flex-col gap-1.5 text-[12.5px]">
                  {card.blockers.map((b) => (
                    <p key={b} className="bg-accent-100 px-2 py-1.5 text-accent-900">
                      {b}
                    </p>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
        <aside className="flex flex-col gap-6">
          <Panel title="Handoff">
            {handoff ? (
              <>
                <p className="text-[12.5px] text-pretty">{handoff.sentence}</p>
                {item?.waitingOn && (
                  <p className="mt-2 bg-accent-100 px-2 py-1.5 text-[12px] text-accent-900">
                    waiting on you · {item.waitingOn}
                  </p>
                )}
              </>
            ) : (
              <Empty>No handoff. Every session on this project closed cleanly.</Empty>
            )}
          </Panel>
          <Panel
            title="Agents on this project"
            aside={
              <Link
                to={`/log?project=${encodeURIComponent(slug)}`}
                className="hover:text-accent"
              >
                full log →
              </Link>
            }
          >
            <Runtimes view={agents.state === "ready" ? agents.data : null} slug={slug} />
            <div className={cn("mt-3 border-t border-divider pt-2.5")}>
              <RecentActions rows={ledger.state === "ready" ? ledger.data.rows : []} />
            </div>
          </Panel>
          <Panel title="Asking for you">
            {card.asking.length === 0 ? (
              <Empty>nothing</Empty>
            ) : (
              <div className="flex flex-wrap gap-1">
                {card.asking.map((reason) => (
                  <Tag key={reason} tone="accent">
                    {reason}
                  </Tag>
                ))}
              </div>
            )}
          </Panel>
        </aside>
      </div>
    </section>
  );
}

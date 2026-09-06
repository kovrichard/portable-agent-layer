import { useState } from "react";
import { Link } from "react-router";
import type { LedgerViewRow } from "../../../ledger/view";
import type { Isc } from "../../../lib/project-isc";
import type { Decision, ProjectDetailView } from "../../detail";
import { Badge } from "../components/badge";
import { Separator } from "../components/separator";
import { clock } from "../format";
import { Empty, Panel, Pending } from "../frame";
import { useLoaded } from "../lib/api";
import { cn } from "../lib/cn";
import { setIsc } from "../lib/write";

const ISC_MARK: Record<Isc["status"], string> = { open: "", done: "✓", retired: "~" };

function outcomeVariant(outcome: string) {
  if (outcome === "applied") return "neutral" as const;
  if (outcome === "failed") return "outline" as const;
  return "alarm" as const;
}

/** Retired is a decision, not a checkbox — only open and done toggle here. */
function Criteria({
  slug,
  iscs,
  onChanged,
}: {
  slug: string;
  iscs: Isc[];
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  if (iscs.length === 0) return <Empty>No criteria written yet.</Empty>;

  const toggle = (isc: Isc) => {
    void setIsc(slug, isc.id, isc.status === "open" ? "done" : "open").then((failure) => {
      setError(failure);
      if (!failure) onChanged();
    });
  };

  return (
    <>
      {error && (
        <p className="mb-2 border-l-2 border-alarm bg-alarm/10 px-3 py-2 text-[12px] text-alarm">
          {error}
        </p>
      )}
      <ul className="m-0 flex list-none flex-col p-0">
        {iscs.map((isc) => (
          <li
            key={isc.id}
            className={cn(
              "grid grid-cols-[18px_58px_1fr] items-start gap-3 border-b border-divider/60 py-2 last:border-b-0",
              isc.status !== "open" && "opacity-60"
            )}
          >
            <button
              type="button"
              disabled={isc.status === "retired"}
              onClick={() => toggle(isc)}
              title={isc.status === "open" ? "close this criterion" : "reopen it"}
              className={cn(
                "mt-0.5 grid size-3.5 cursor-pointer place-items-center border border-neutral-500 text-[10px] leading-none text-bg hover:border-accent disabled:cursor-default",
                isc.status === "done" && "bg-accent",
                isc.status === "retired" && "bg-neutral-400"
              )}
            >
              {ISC_MARK[isc.status]}
              <span className="sr-only">{isc.status}</span>
            </button>
            <span className="pt-px text-[11.5px] text-neutral-600">ISC-{isc.id}</span>
            <span className="text-pretty">{isc.text}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Decisions({ decisions }: { decisions: Decision[] }) {
  if (decisions.length === 0) return <Empty>Nothing recorded.</Empty>;
  return (
    <div className="flex flex-col gap-1.5 text-[12.5px]">
      {decisions.map((d) => (
        <div key={d.text} className="grid grid-cols-[78px_1fr] gap-3">
          <span className="text-[11.5px] text-neutral-600">{d.date ?? "—"}</span>
          <span>
            {d.text}
            {d.why && <span className="text-neutral-600"> — {d.why}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function Runtimes({ runtimes }: { runtimes: Record<string, number> }) {
  const entries = Object.entries(runtimes);
  if (entries.length === 0) return <Empty>No recorded actions in the window.</Empty>;
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([runtime, n]) => (
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

function RecentActions({ rows }: { rows: LedgerViewRow[] }) {
  if (rows.length === 0) return <Empty>Nothing recorded yet.</Empty>;
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.id} className="grid grid-cols-[86px_1fr_auto] gap-2 text-[11.5px]">
          <span className="text-neutral-600">{clock(r.ts).slice(5)}</span>
          <span className="truncate">
            <b className="font-medium">{r.tool}</b>{" "}
            <span className="text-neutral-700">{r.target}</span>
          </span>
          <Badge variant={outcomeVariant(r.outcome)}>{r.outcome}</Badge>
        </div>
      ))}
    </div>
  );
}

function Head({ d }: { d: ProjectDetailView }) {
  const open = d.iscs.filter((i) => i.status === "open").length;
  return (
    <>
      <nav className="mb-1.5 text-[12px] text-neutral-600">
        <Link to="/projects" className="hover:text-accent">
          projects
        </Link>{" "}
        / {d.slug}
      </nav>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="m-0 flex items-center gap-3 text-[38px]">
            {d.slug}
            <Badge variant="neutral">{d.status}</Badge>
          </h1>
          <p className="max-w-[760px] text-[13px] text-pretty text-neutral-800">
            {d.goal || d.purpose}
          </p>
        </div>
        <div className="text-right text-[11.5px] text-neutral-600">
          <div>{d.remote ?? "no remote on record"}</div>
          <div>{d.path ?? "not checked out here"}</div>
          <div>
            {open} open · serves {d.serves ?? "nothing on record"}
            {d.servesBy && ` · ${d.servesBy}`}
          </div>
        </div>
      </div>
    </>
  );
}

export function ProjectDetail({ slug }: { slug: string }) {
  const [nonce, setNonce] = useState(0);
  const view = useLoaded<ProjectDetailView>(
    `/api/project?slug=${encodeURIComponent(slug)}&v=${nonce}`
  );
  if (view.state !== "ready") return <Pending value={view} />;
  const d = view.data;
  const reload = () => setNonce((n) => n + 1);

  return (
    <section>
      <Head d={d} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-6">
          <Panel
            title="Ideal state criteria"
            aside="changes here write to the record directly · no agent, no tokens"
          >
            <Criteria slug={d.slug} iscs={d.iscs} onChanged={reload} />
          </Panel>
          <div className="grid gap-6 md:grid-cols-2">
            <Panel title="Next">
              {d.next.length === 0 ? (
                <Empty>nothing queued</Empty>
              ) : (
                <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-[12.5px]">
                  {d.next.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ol>
              )}
            </Panel>
            <Panel title="Blockers">
              {d.blockers.length === 0 ? (
                <Empty>none</Empty>
              ) : (
                <div className="flex flex-col gap-1.5 text-[12.5px]">
                  {d.blockers.map((b) => (
                    <p key={b} className="bg-accent-100 px-2 py-1.5 text-accent-900">
                      {b}
                    </p>
                  ))}
                </div>
              )}
            </Panel>
          </div>
          <Panel title="Decisions">
            <Decisions decisions={d.decisions} />
          </Panel>
        </div>
        <aside className="flex flex-col gap-6">
          <Panel title="Handoff">
            {d.handoff ? (
              <>
                <p className="text-[12.5px] text-pretty" title={d.handoff.full}>
                  {d.handoff.sentence}
                </p>
                {d.handoff.waitingOn && (
                  <p className="mt-2 bg-accent-100 px-2 py-1.5 text-[12px] text-accent-900">
                    waiting on you · {d.handoff.waitingOn}
                  </p>
                )}
              </>
            ) : (
              <Empty>No handoff. Every session on this project closed cleanly.</Empty>
            )}
          </Panel>
          <Panel
            title="Agents on this project · 14d"
            aside={
              <Link
                to={`/log?project=${encodeURIComponent(d.slug)}`}
                className="hover:text-accent"
              >
                full log →
              </Link>
            }
          >
            <Runtimes runtimes={d.runtimes} />
            <Separator className="my-3" />
            <RecentActions rows={d.recent} />
          </Panel>
          <Panel title="Context">
            {d.context.length === 0 ? (
              <Empty>nothing recorded</Empty>
            ) : (
              <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-[12.5px]">
                {d.context.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
    </section>
  );
}

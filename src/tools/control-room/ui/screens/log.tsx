import type { ReactNode } from "react";
import type { LedgerView, LedgerViewRow, PageOutcome } from "../../../ledger/view";
import { PAGE_OUTCOMES } from "../../../ledger/view";
import { clock } from "../format";
import { Empty, Pending, Tag } from "../frame";
import { useLoaded } from "../lib/api";
import { cn } from "../lib/cn";

const MAX_ROWS = 200;

export interface LogFilter {
  project: string;
  since: string;
  until: string;
}

function ledgerQuery(filter: LogFilter): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `/api/ledger?${query}` : "/api/ledger";
}

function outcomeTone(outcome: string) {
  if (outcome === "applied") return "neutral" as const;
  if (outcome === "failed") return "outline" as const;
  return "alarm" as const;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      {children}
    </div>
  );
}

const CONTROL =
  "border border-divider bg-bg px-2 py-1.5 text-[12px] text-ink focus-visible:border-accent";

function Stats({ view }: { view: LedgerView }) {
  const cells: { n: number; label: string }[] = [
    { n: view.stats.total, label: "actions" },
    { n: view.stats.refusals, label: "refusals" },
    ...PAGE_OUTCOMES.map((o: PageOutcome) => ({
      n: view.stats.outcomes[o].total,
      label: o,
    })),
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-px border border-divider bg-divider sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((cell) => (
        <div key={cell.label} className="bg-bg px-3 py-2.5">
          <div className="font-heading text-[26px] leading-none font-semibold tabular-nums">
            {cell.n}
          </div>
          <div className="eyebrow">{cell.label}</div>
        </div>
      ))}
    </div>
  );
}

function Row({ r }: { r: LedgerViewRow }) {
  return (
    <tr className="border-b border-divider/60 last:border-b-0">
      <td className="px-3 py-2 whitespace-nowrap text-neutral-700">{clock(r.ts)}</td>
      <td className="px-3 py-2">
        {r.actor}
        <span className="block text-[11px] text-neutral-600">
          {r.authority} · {r.runtime}
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-[11.5px]">{r.tool}</td>
      <td className="px-3 py-2" title={r.target}>
        {r.target}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-neutral-700">{r.change}</td>
      <td className="px-3 py-2">
        <Tag tone={outcomeTone(r.outcome)}>{r.outcome}</Tag>
        {r.reason && (
          <span className="block max-w-[220px] text-[11px] text-neutral-700">
            {r.reason}
          </span>
        )}
      </td>
    </tr>
  );
}

export function Log({
  filter,
  onFilter,
}: {
  filter: LogFilter;
  onFilter: (next: Partial<LogFilter>) => void;
}) {
  const projects = useLoaded<{ slug: string }[]>("/api/projects");
  const view = useLoaded<LedgerView>(ledgerQuery(filter));

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="project">
          <select
            aria-label="filter by project"
            className={CONTROL}
            value={filter.project}
            onChange={(e) => onFilter({ project: e.target.value })}
          >
            <option value="">all</option>
            {projects.state === "ready" &&
              projects.data.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.slug}
                </option>
              ))}
          </select>
        </Field>
        <Field label="since">
          <input
            type="date"
            aria-label="actions since"
            className={CONTROL}
            value={filter.since}
            onChange={(e) => onFilter({ since: e.target.value })}
          />
        </Field>
        <Field label="until">
          <input
            type="date"
            aria-label="actions until"
            className={CONTROL}
            value={filter.until}
            onChange={(e) => onFilter({ until: e.target.value })}
          />
        </Field>
        <button
          type="button"
          className={cn(CONTROL, "cursor-pointer hover:bg-neutral-200")}
          onClick={() => onFilter({ project: "", since: "", until: "" })}
        >
          reset
        </button>
      </div>

      <Pending value={view} />
      {view.state === "ready" && (
        <>
          <Stats view={view.data} />
          <div className="blueprint overflow-x-auto bg-bg">
            {view.data.rows.length === 0 ? (
              <Empty>No actions in this window.</Empty>
            ) : (
              <table className="w-full min-w-[880px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-divider text-left">
                    <th className="eyebrow px-3 py-2">when</th>
                    <th className="eyebrow px-3 py-2">actor</th>
                    <th className="eyebrow px-3 py-2">action</th>
                    <th className="eyebrow px-3 py-2">target</th>
                    <th className="eyebrow px-3 py-2">change</th>
                    <th className="eyebrow px-3 py-2">outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {view.data.rows.slice(0, MAX_ROWS).map((r) => (
                    <Row key={r.id} r={r} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {view.data.rows.length > MAX_ROWS && (
            <Empty>
              Newest {MAX_ROWS} of {view.data.rows.length}. Narrow the window for the
              rest.
            </Empty>
          )}
        </>
      )}
    </section>
  );
}

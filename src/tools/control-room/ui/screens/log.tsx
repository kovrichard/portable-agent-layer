import { useId } from "react";
import type { LedgerView, LedgerViewRow, PageOutcome } from "../../../ledger/view";
import { PAGE_OUTCOMES } from "../../../ledger/view";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { Input, NativeSelect } from "../components/input";
import { Label } from "../components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/table";
import { clock } from "../format";
import { Empty, Pending, Scroller } from "../frame";
import { useLoaded } from "../lib/api";

const MAX_ROWS = 200;

const COLUMNS = ["when", "actor", "action", "target", "change", "outcome"] as const;

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

function outcomeVariant(outcome: string) {
  if (outcome === "applied") return "neutral" as const;
  if (outcome === "failed") return "outline" as const;
  return "alarm" as const;
}

function Field({
  label,
  control,
}: {
  label: string;
  control: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {control(id)}
    </div>
  );
}

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
    <TableRow>
      <TableCell className="whitespace-nowrap text-neutral-700">{clock(r.ts)}</TableCell>
      <TableCell>
        {r.actor}
        <span className="block text-[11px] text-neutral-600">
          {r.authority} · {r.runtime}
        </span>
      </TableCell>
      <TableCell className="font-mono text-[11.5px]">{r.tool}</TableCell>
      <TableCell title={r.target}>{r.target}</TableCell>
      <TableCell className="whitespace-nowrap text-neutral-700">{r.change}</TableCell>
      <TableCell>
        <Badge variant={outcomeVariant(r.outcome)}>{r.outcome}</Badge>
        {r.reason && (
          <span className="block max-w-[220px] text-[11px] text-neutral-700">
            {r.reason}
          </span>
        )}
      </TableCell>
    </TableRow>
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
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field
          label="project"
          control={(id) => (
            <NativeSelect
              id={id}
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
            </NativeSelect>
          )}
        />
        <Field
          label="since"
          control={(id) => (
            <Input
              id={id}
              type="date"
              value={filter.since}
              onChange={(e) => onFilter({ since: e.target.value })}
            />
          )}
        />
        <Field
          label="until"
          control={(id) => (
            <Input
              id={id}
              type="date"
              value={filter.until}
              onChange={(e) => onFilter({ until: e.target.value })}
            />
          )}
        />
        <Button
          variant="secondary"
          onClick={() => onFilter({ project: "", since: "", until: "" })}
        >
          reset
        </Button>
      </div>

      <Pending value={view} />
      {view.state === "ready" && (
        <>
          <Stats view={view.data} />
          <div className="blueprint flex min-h-0 flex-1 flex-col bg-bg">
            {view.data.rows.length === 0 ? (
              <Empty>No actions in this window.</Empty>
            ) : (
              <Scroller>
                <Table className="min-w-[880px] text-[12.5px]">
                  <TableHeader>
                    <tr>
                      {COLUMNS.map((column) => (
                        <TableHead key={column}>{column}</TableHead>
                      ))}
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {view.data.rows.slice(0, MAX_ROWS).map((r) => (
                      <Row key={r.id} r={r} />
                    ))}
                  </TableBody>
                </Table>
              </Scroller>
            )}
          </div>
          {view.data.rows.length > MAX_ROWS && (
            <p className="pt-2 text-[12px] text-neutral-500">
              Newest {MAX_ROWS} of {view.data.rows.length}. Narrow the window for the
              rest.
            </p>
          )}
        </>
      )}
    </section>
  );
}

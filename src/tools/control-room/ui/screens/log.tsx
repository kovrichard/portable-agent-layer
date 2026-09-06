import { useId, useState } from "react";
import { PAGE_OUTCOMES, type PageOutcome } from "../../../ledger/outcomes";
import type { LedgerView, LedgerViewRow } from "../../../ledger/view";
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
import { type Loaded, useLoaded } from "../lib/api";

const MAX_ROWS = 200;

const COLUMNS = [
  "when",
  "machine",
  "actor",
  "action",
  "target",
  "change",
  "outcome",
] as const;

export const LOG_KEYS = [
  "project",
  "runtime",
  "machine",
  "authority",
  "outcome",
  "since",
  "until",
] as const;

export type LogFilter = Record<(typeof LOG_KEYS)[number], string>;

const AUTHORITIES = ["user", "agent"] as const;
const RUNTIMES = ["claude", "cursor", "codex", "copilot", "opencode", "unknown"] as const;

const EMPTY_FILTER: LogFilter = {
  project: "",
  runtime: "",
  machine: "",
  authority: "",
  outcome: "",
  since: "",
  until: "",
};

/** The machines a row could name are whatever the window actually contains. */
function machinesIn(view: Loaded<LedgerView>): string[] {
  if (view.state !== "ready") return [];
  return [...new Set(view.data.rows.map((r) => r.machine))].filter(Boolean).sort();
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

/** A refusal carries the command it stopped; an edit carries its line counts. */
function Row({
  r,
  open,
  onToggle,
}: {
  r: LedgerViewRow;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="whitespace-nowrap text-neutral-700">
          {clock(r.ts)}
        </TableCell>
        <TableCell className="whitespace-nowrap">{r.machine}</TableCell>
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
      {open && (r.command || r.reason) && (
        <TableRow>
          <TableCell colSpan={COLUMNS.length} className="bg-neutral-200">
            <pre className="m-0 font-mono text-[11.5px] whitespace-pre-wrap">
              {r.command ? `$ ${r.command}\n` : ""}
              {r.reason ?? ""}
            </pre>
          </TableCell>
        </TableRow>
      )}
    </>
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
  const [expanded, setExpanded] = useState<string | null>(null);

  const choices = (key: keyof LogFilter, values: readonly string[], all = "all") => (
    <Field
      label={key}
      control={(id) => (
        <NativeSelect
          id={id}
          value={filter[key]}
          onChange={(e) => onFilter({ [key]: e.target.value })}
        >
          <option value="">{all}</option>
          {values.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </NativeSelect>
      )}
    />
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {choices(
          "project",
          projects.state === "ready" ? projects.data.map((p) => p.slug) : []
        )}
        {choices("runtime", RUNTIMES)}
        {choices("machine", machinesIn(view), "both")}
        {choices("authority", AUTHORITIES)}
        {choices("outcome", PAGE_OUTCOMES)}
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
        <Button variant="secondary" onClick={() => onFilter(EMPTY_FILTER)}>
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
                      <Row
                        key={r.id}
                        r={r}
                        open={expanded === r.id}
                        onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                      />
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

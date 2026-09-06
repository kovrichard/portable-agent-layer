import { useState } from "react";
import type { LedgerView } from "../../../ledger/view";
import type { AgendaView, HandoffCard, SignalView } from "../../data";
import type { Matrix, MatrixItem } from "../../matrix";
import { Badge } from "../components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/table";
import { tenths } from "../format";
import { Empty, Panel, Pending } from "../frame";
import { type Loaded, useLoaded } from "../lib/api";
import { cn } from "../lib/cn";
import { GoalsList, HandoffList, ItemCard, MovesList, ReasonTags } from "../parts";

export const LAYOUTS = [
  { value: "matrix", label: "matrix" },
  { value: "list", label: "list" },
  { value: "briefing", label: "briefing" },
] as const;

export type Layout = (typeof LAYOUTS)[number]["value"];

export function isLayout(value: string | null): value is Layout {
  return LAYOUTS.some((l) => l.value === value);
}

const QUADRANTS = [
  { id: "now", title: "Do now", note: "matters and cannot wait", lit: true },
  {
    id: "plan",
    title: "Give it a slot",
    note: "matters, nothing forcing it",
    lit: false,
  },
  {
    id: "noise",
    title: "Loud, not load-bearing",
    note: "pressing but serves nothing",
    lit: false,
  },
  { id: "later", title: "Let it sit", note: "neither", lit: false },
] as const;

const FORTNIGHT_DAYS = 14;

function fortnightQuery(): string {
  const since = new Date(Date.now() - FORTNIGHT_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return `/api/ledger?since=${since}`;
}

function goalsOf(matrix: Matrix): MatrixItem[] {
  return [...matrix.now, ...matrix.plan, ...matrix.noise, ...matrix.later].filter(
    (i) => i.kind === "goal"
  );
}

function rankedOf(matrix: Matrix): { item: MatrixItem; quadrant: string }[] {
  return QUADRANTS.flatMap(({ id, title }) =>
    (matrix[id] as MatrixItem[]).map((item) => ({ item, quadrant: title }))
  );
}

function Quadrant({
  title,
  note,
  lit,
  items,
  onSaved,
  compact,
}: {
  title: string;
  note: string;
  lit: boolean;
  items: MatrixItem[];
  onSaved: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "blueprint flex flex-col gap-2 p-4",
        lit ? "bg-accent-100" : "bg-transparent",
        compact ? "min-h-[120px]" : "min-h-[160px]"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-[20px]">{title}</h3>
        <span className="text-[11px] text-neutral-700">{note}</span>
      </div>
      {items.length === 0 ? (
        <Empty>nothing here</Empty>
      ) : (
        items.map((item) => (
          <ItemCard key={`${item.kind}:${item.id}`} item={item} onSaved={onSaved} />
        ))
      )}
    </div>
  );
}

function Fortnight() {
  const ledger = useLoaded<LedgerView>(fortnightQuery());
  const signal = useLoaded<SignalView>("/api/signal");
  const stats = ledger.state === "ready" ? ledger.data.stats : null;
  const rating = signal.state === "ready" ? signal.data.ratings : null;
  return (
    <Panel title={`Last ${FORTNIGHT_DAYS} days`}>
      <dl className="m-0 grid grid-cols-3 gap-2">
        <Figure n={stats ? String(stats.total) : "—"} label="actions" />
        <Figure n={stats ? String(stats.refusals) : "—"} label="refusals" />
        <Figure n={rating ? tenths(rating.recentAvg) : "—"} label="rating, last 10" />
      </dl>
    </Panel>
  );
}

function Figure({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <dt className="font-heading text-[26px] leading-none font-semibold tabular-nums">
        {n}
      </dt>
      <dd className="m-0 text-[11px] text-neutral-600">{label}</dd>
    </div>
  );
}

function DueBadges() {
  const signal = useLoaded<SignalView>("/api/signal");
  if (signal.state !== "ready") return <Pending value={signal} />;
  const due = Object.entries(signal.data.due).filter(([, b]) => b.state === "due");
  if (due.length === 0) return <Empty>Nothing is due.</Empty>;
  return (
    <div className="flex flex-col gap-2">
      {due.map(([name, badge]) => (
        <div key={name} className="text-[12px]">
          <Badge variant="accent">{name}</Badge>
          <span className="ml-2 text-neutral-700">{badge.detail}</span>
        </div>
      ))}
    </div>
  );
}

function Sidebar({ matrix, handoffs }: { matrix: Matrix; handoffs: HandoffCard[] }) {
  return (
    <aside className="flex flex-col gap-6">
      <Panel title="Where you left off">
        <HandoffList cards={handoffs} />
      </Panel>
      <Panel title="Goals">
        <GoalsList goals={goalsOf(matrix)} />
      </Panel>
      <Fortnight />
      <Panel title="Needs a run">
        <DueBadges />
      </Panel>
    </aside>
  );
}

function MatrixLayout({
  matrix,
  handoffs,
  moves,
  onSaved,
}: {
  matrix: Matrix;
  handoffs: HandoffCard[];
  moves: AgendaView["moves"];
  onSaved: () => void;
}) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        <div className="mb-6 grid gap-px border border-divider bg-divider md:grid-cols-3">
          {moves.map((move, i) => (
            <div
              key={move.move}
              className="grid grid-cols-[26px_1fr] gap-2 bg-bg px-4 py-3"
            >
              <span className="font-heading text-[22px] leading-none font-semibold text-accent">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>
                <span className="block font-medium text-pretty">{move.move}</span>
                <span className="text-[12px] text-neutral-700">{move.because}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[18px_minmax(0,1fr)_minmax(0,1fr)]">
          <div />
          <div className="eyebrow pb-1.5 pl-3">urgent</div>
          <div className="eyebrow pb-1.5 pl-3">not urgent</div>
          <div className="eyebrow [writing-mode:vertical-rl] rotate-180 text-center">
            important
          </div>
          {QUADRANTS.slice(0, 2).map((q) => (
            <Quadrant
              key={q.id}
              {...q}
              items={matrix[q.id] as MatrixItem[]}
              onSaved={onSaved}
            />
          ))}
          <div className="eyebrow [writing-mode:vertical-rl] rotate-180 text-center">
            not important
          </div>
          {QUADRANTS.slice(2).map((q) => (
            <Quadrant
              key={q.id}
              {...q}
              items={matrix[q.id] as MatrixItem[]}
              onSaved={onSaved}
            />
          ))}
        </div>
      </div>
      <Sidebar matrix={matrix} handoffs={handoffs} />
    </div>
  );
}

function ListLayout({
  matrix,
  handoffs,
  moves,
}: {
  matrix: Matrix;
  handoffs: HandoffCard[];
  moves: AgendaView["moves"];
  onSaved: () => void;
}) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="blueprint overflow-x-auto bg-bg">
        <Table className="min-w-[720px] text-[13px]">
          <TableHeader>
            <tr>
              {["Item", "Placed", "Why", "Next"].map((column) => (
                <TableHead key={column}>{column}</TableHead>
              ))}
            </tr>
          </TableHeader>
          <TableBody>
            {rankedOf(matrix).map(({ item, quadrant }) => (
              <TableRow key={`${item.kind}:${item.id}`}>
                <TableCell>
                  <span className="font-heading text-[15px] font-semibold">
                    {item.label}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{quadrant}</TableCell>
                <TableCell className="min-w-[200px]">
                  <ReasonTags item={item} />
                </TableCell>
                <TableCell className="max-w-[320px] text-[12px] text-neutral-800">
                  {item.detail}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <aside className="flex flex-col gap-6">
        <Panel title="Three moves">
          <MovesList moves={moves} />
        </Panel>
        <Panel title="Grid">
          <div className="grid grid-cols-2 gap-1">
            {QUADRANTS.map((q) => (
              <div key={q.id} className="border border-divider p-2">
                <span className="font-heading block text-[24px] leading-none font-semibold">
                  {(matrix[q.id] as MatrixItem[]).length}
                </span>
                <span className="eyebrow">{q.title}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Where you left off">
          <HandoffList cards={handoffs} />
        </Panel>
      </aside>
    </div>
  );
}

function BriefingLayout({
  matrix,
  handoffs,
  moves,
  onSaved,
}: {
  matrix: Matrix;
  handoffs: HandoffCard[];
  moves: AgendaView["moves"];
  onSaved: () => void;
}) {
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="flex flex-col gap-8">
        <div>
          <h6 className="eyebrow mb-2">If you only do three things</h6>
          <MovesList moves={moves} size="large" />
        </div>
        <div>
          <h6 className="eyebrow mb-2">Where you left off</h6>
          <HandoffList cards={handoffs} />
        </div>
      </div>
      <div className="flex flex-col gap-6">
        <div>
          <h6 className="eyebrow mb-2">The grid</h6>
          <div className="grid grid-cols-2 gap-1.5">
            {QUADRANTS.map((q) => (
              <Quadrant
                key={q.id}
                {...q}
                compact
                items={matrix[q.id] as MatrixItem[]}
                onSaved={onSaved}
              />
            ))}
          </div>
        </div>
        <Panel title="Goals">
          <GoalsList goals={goalsOf(matrix)} />
        </Panel>
      </div>
    </div>
  );
}

function Heading({ agenda, matrix }: { agenda: AgendaView; matrix: Matrix }) {
  const written = agenda.generatedAt
    ? `agenda written ${agenda.ageHours ?? 0}h ago at session stop`
    : "no agenda written yet";
  return (
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-4">
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="m-0 text-[34px]">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </h1>
        <span
          className={cn("text-[12px]", agenda.stale ? "text-alarm" : "text-neutral-700")}
        >
          {written} · {matrix.now.length} items need you
        </span>
      </div>
      {matrix.unranked > 0 && (
        <span className="text-[12px] text-neutral-700">
          {matrix.unranked} project(s) with no purpose on record
        </span>
      )}
    </div>
  );
}

export function Today({ layout }: { layout: Layout }) {
  const [nonce, setNonce] = useState(0);
  const matrix = useLoaded<Matrix>(`/api/matrix?v=${nonce}`);
  const agenda = useLoaded<AgendaView>("/api/agenda");
  const handoffs = useLoaded<HandoffCard[]>("/api/handoffs");
  const reload = () => setNonce((n) => n + 1);

  const waiting: Loaded<unknown>[] = [matrix, agenda, handoffs];
  const notReady = waiting.find((v) => v.state !== "ready");
  if (notReady || matrix.state !== "ready") return <Pending value={notReady ?? matrix} />;
  if (agenda.state !== "ready" || handoffs.state !== "ready") return null;

  const shared = {
    matrix: matrix.data,
    handoffs: handoffs.data,
    moves: agenda.data.moves,
    onSaved: reload,
  };
  return (
    <section>
      <Heading agenda={agenda.data} matrix={matrix.data} />
      {layout === "matrix" && <MatrixLayout {...shared} />}
      {layout === "list" && <ListLayout {...shared} />}
      {layout === "briefing" && <BriefingLayout {...shared} />}
    </section>
  );
}

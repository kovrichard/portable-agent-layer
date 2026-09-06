import { Link } from "react-router";
import type { AgendaMove } from "../../../hooks/lib/agenda-store";
import type { HandoffCard } from "../data";
import type { MatrixItem } from "../matrix";
import { age } from "./format";
import { Empty, Tag } from "./frame";
import { cn } from "./lib/cn";

const SERVES_KINDS = ["goal", "revenue", "fun"] as const;

async function saveServes(project: string, serves: string): Promise<void> {
  const res = await fetch("/api/serves", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project, serves }),
  });
  if (!res.ok) throw new Error(`override answered ${res.status}`);
}

function ServesSelect({ item, onSaved }: { item: MatrixItem; onSaved: () => void }) {
  if (item.kind !== "project") return null;
  return (
    <select
      value={item.serves ?? ""}
      title={
        item.servesBy === "user" ? "your answer" : "PAL's guess — change it to correct it"
      }
      onChange={(e) => {
        saveServes(item.id, e.target.value).then(onSaved).catch(onSaved);
      }}
      className={cn(
        "cursor-pointer border px-2 py-0.5 text-[10px]",
        item.servesBy === "user"
          ? "border-accent bg-accent-100 text-accent-900"
          : "border-divider bg-transparent text-neutral-700"
      )}
    >
      <option value="" disabled>
        unranked
      </option>
      {SERVES_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {kind}
        </option>
      ))}
    </select>
  );
}

export function ReasonTags({ item }: { item: MatrixItem }) {
  return (
    <div className="flex flex-wrap gap-1">
      {item.urgentBecause.map((reason) => (
        <Tag key={reason} tone="accent">
          {reason}
        </Tag>
      ))}
      <Tag tone="neutral">{item.importantBecause}</Tag>
    </div>
  );
}

export function ItemCard({ item, onSaved }: { item: MatrixItem; onSaved: () => void }) {
  const isProject = item.kind === "project";
  return (
    <article className="flex flex-col gap-2 border border-divider bg-bg px-3 py-3 hover:border-accent">
      <div className="flex items-center gap-2">
        {isProject ? (
          <Link
            to={`/projects/${item.id}`}
            className="font-heading text-[16px] font-semibold text-ink hover:text-accent"
          >
            {item.label}
          </Link>
        ) : (
          <span className="font-heading text-[16px] font-semibold text-ink">
            {item.label}
          </span>
        )}
        {isProject ? (
          <ServesSelect item={item} onSaved={onSaved} />
        ) : (
          <Tag tone="accent">goal</Tag>
        )}
        <span className="ml-auto text-[11px] whitespace-nowrap text-neutral-600">
          {item.due ?? ""}
        </span>
      </div>
      {item.waitingOn && (
        <p className="bg-accent-100 px-2 py-1.5 text-[12px] text-accent-900">
          waiting on you · {item.waitingOn}
        </p>
      )}
      {item.detail && <p className="text-[12px] text-neutral-800">{item.detail}</p>}
      <ReasonTags item={item} />
    </article>
  );
}

export function MovesList({
  moves,
  size = "compact",
}: {
  moves: AgendaMove[];
  size?: "compact" | "large";
}) {
  if (moves.length === 0) {
    return (
      <Empty>
        No moves yet. They are written when a session ends — finish one and come back.
      </Empty>
    );
  }
  return (
    <ol className="flex list-none flex-col gap-0 p-0">
      {moves.map((move, i) => (
        <li
          key={move.move}
          className={cn(
            "grid items-start gap-4 border-t border-divider py-4 first:border-t-0",
            size === "large" ? "grid-cols-[44px_1fr]" : "grid-cols-[26px_1fr]"
          )}
        >
          <span
            className={cn(
              "font-heading leading-none font-semibold text-accent",
              size === "large" ? "text-[40px]" : "text-[22px]"
            )}
          >
            {String(i + 1).padStart(2, "0")}
          </span>
          <span>
            <span
              className={cn(
                "block font-medium text-pretty",
                size === "large" && "font-heading text-[22px] leading-tight font-semibold"
              )}
            >
              {move.move}
            </span>
            <span className="text-[12px] text-neutral-700">{move.because}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function HandoffList({ cards }: { cards: HandoffCard[] }) {
  if (cards.length === 0) {
    return <Empty>Nothing in progress. Every handoff is closed.</Empty>;
  }
  return (
    <div className="flex flex-col gap-3">
      {cards.map((h) => (
        <div key={h.cwd} className="flex flex-col gap-1">
          <span className="flex justify-between gap-2 text-[11px] text-neutral-600">
            {h.slug ? (
              <Link
                to={`/projects/${h.slug}`}
                className="font-semibold text-ink hover:text-accent"
              >
                {h.label}
              </Link>
            ) : (
              <b className="font-semibold text-ink">{h.label}</b>
            )}
            <span>
              {h.source} · {age(h.ageDays)}
            </span>
          </span>
          <span className="text-[12.5px] text-pretty" title={h.handoff}>
            {h.sentence}
          </span>
        </div>
      ))}
    </div>
  );
}

export function GoalsList({ goals }: { goals: MatrixItem[] }) {
  if (goals.length === 0) return <Empty>No goals written down yet.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      {goals.map((goal) => (
        <div key={goal.id}>
          <div className="flex justify-between gap-2 text-[12.5px]">
            <span className="text-pretty">{goal.label}</span>
            <span className="text-[11px] whitespace-nowrap text-neutral-600">
              {goal.due ?? goal.detail}
            </span>
          </div>
          {goal.urgentBecause.length > 0 && (
            <div className="mt-1 text-[11px] text-neutral-600">
              {goal.urgentBecause.join(" · ")}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

import { Link } from "react-router";
import type { AgentsView, ProjectCard } from "../../data";
import type { Matrix, MatrixItem } from "../../matrix";
import { age } from "../format";
import { Empty, Pending, Tag } from "../frame";
import { useLoaded } from "../lib/api";

export const STATUS_FILTERS = [
  { value: "ranked", label: "active + paused" },
  { value: "active", label: "active" },
  { value: "paused", label: "paused" },
  { value: "all", label: "all" },
] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

export function isStatusFilter(value: string | null): value is StatusFilter {
  return STATUS_FILTERS.some((f) => f.value === value);
}

const RANKED = new Set(["active", "paused"]);

function keep(card: ProjectCard, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "ranked") return RANKED.has(card.status);
  return card.status === filter;
}

function servesByProject(matrix: Matrix): Map<string, MatrixItem> {
  const all = [...matrix.now, ...matrix.plan, ...matrix.noise, ...matrix.later];
  return new Map(all.filter((i) => i.kind === "project").map((i) => [i.id, i]));
}

function Row({
  card,
  item,
  runtimes,
}: {
  card: ProjectCard;
  item: MatrixItem | undefined;
  runtimes: string[];
}) {
  return (
    <tr className="border-b border-divider/60 last:border-b-0 hover:bg-neutral-200/50">
      <td className="px-3 py-2">
        <Link
          to={`/projects/${card.slug}`}
          className="font-heading text-[15px] font-semibold text-ink hover:text-accent"
        >
          {card.slug}
        </Link>
        {card.next[0] && (
          <span className="block text-[11.5px] text-neutral-700">{card.next[0]}</span>
        )}
      </td>
      <td className="px-3 py-2">
        <Tag tone="neutral">{card.status}</Tag>
      </td>
      <td className="px-3 py-2 text-[12px]">
        {item?.serves ?? "unranked"}
        {item?.servesBy && (
          <span className="ml-1 text-[10.5px] text-neutral-600">· {item.servesBy}</span>
        )}
      </td>
      <td className="font-heading px-3 py-2 text-right text-[16px] font-semibold tabular-nums">
        {card.openIscs}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{card.sessions30d}</td>
      <td className="px-3 py-2">
        <span className="flex flex-wrap gap-1">
          {runtimes.map((runtime) => (
            <Tag key={runtime} tone="outline">
              {runtime}
            </Tag>
          ))}
        </span>
      </td>
      <td className="px-3 py-2 text-[12px] text-neutral-700">
        {card.path ?? "not checked out here"}
      </td>
      <td className="px-3 py-2 text-right text-[12px] whitespace-nowrap text-neutral-700">
        {age(card.ageDays)}
      </td>
    </tr>
  );
}

export function Projects({ filter }: { filter: StatusFilter }) {
  const board = useLoaded<ProjectCard[]>("/api/board");
  const matrix = useLoaded<Matrix>("/api/matrix");
  const agents = useLoaded<AgentsView>("/api/agents");

  if (board.state !== "ready") return <Pending value={board} />;
  const serves = matrix.state === "ready" ? servesByProject(matrix.data) : new Map();
  const runtimesFor = (slug: string) =>
    agents.state === "ready"
      ? Object.keys(agents.data.projects.find((p) => p.slug === slug)?.runtimes ?? {})
      : [];

  const rows = board.data.filter((card) => keep(card, filter));
  return (
    <div className="blueprint overflow-x-auto bg-bg">
      {rows.length === 0 ? (
        <Empty>No project matches this filter.</Empty>
      ) : (
        <table className="w-full min-w-[880px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-divider text-left">
              <th className="eyebrow px-3 py-2">Project</th>
              <th className="eyebrow px-3 py-2">Status</th>
              <th className="eyebrow px-3 py-2">Serves</th>
              <th className="eyebrow px-3 py-2 text-right">Open ISCs</th>
              <th className="eyebrow px-3 py-2 text-right">Sessions / 30d</th>
              <th className="eyebrow px-3 py-2">Agents</th>
              <th className="eyebrow px-3 py-2">Here</th>
              <th className="eyebrow px-3 py-2 text-right">Touched</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((card) => (
              <Row
                key={card.slug}
                card={card}
                item={serves.get(card.slug)}
                runtimes={runtimesFor(card.slug)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

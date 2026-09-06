import { Link } from "react-router";
import type { ProjectCard } from "../../data";
import { Badge } from "../components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/table";
import { age } from "../format";
import { Empty, Pending, Scroller } from "../frame";
import { useLoaded } from "../lib/api";
import { cn } from "../lib/cn";

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

const COLUMNS = [
  { label: "Project", numeric: false },
  { label: "Status", numeric: false },
  { label: "Serves", numeric: false },
  { label: "Open ISCs", numeric: true },
  { label: "Sessions / 30d", numeric: true },
  { label: "Agents", numeric: false },
  { label: "Here", numeric: false },
  { label: "Touched", numeric: true },
] as const;

function keep(card: ProjectCard, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "ranked") return RANKED.has(card.status);
  return card.status === filter;
}

function Row({ card }: { card: ProjectCard }) {
  return (
    <TableRow>
      <TableCell>
        <Link
          to={`/projects/${card.slug}`}
          className="font-heading text-[15px] font-semibold text-ink hover:text-accent"
        >
          {card.slug}
        </Link>
        {card.next[0] && (
          <span className="block text-[11.5px] text-neutral-700">{card.next[0]}</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="neutral">{card.status}</Badge>
      </TableCell>
      <TableCell className="text-[12px]">
        {card.serves ?? "unranked"}
        {card.servesBy && (
          <span className="ml-1 text-[10.5px] text-neutral-600">· {card.servesBy}</span>
        )}
      </TableCell>
      <TableCell className="font-heading text-right text-[16px] font-semibold tabular-nums">
        {card.openIscs}
      </TableCell>
      <TableCell className="text-right tabular-nums">{card.sessions30d}</TableCell>
      <TableCell>
        <span className="flex flex-wrap gap-1">
          {Object.entries(card.runtimes).map(([runtime, n]) => (
            <Badge key={runtime} variant="outline">
              {runtime} {n}
            </Badge>
          ))}
        </span>
      </TableCell>
      <TableCell className="text-[12px] text-neutral-700">
        {card.path ?? "not checked out here"}
      </TableCell>
      <TableCell className="text-right text-[12px] whitespace-nowrap text-neutral-700">
        {age(card.ageDays)}
      </TableCell>
    </TableRow>
  );
}

export function Projects({ filter }: { filter: StatusFilter }) {
  const board = useLoaded<ProjectCard[]>("/api/board");
  if (board.state !== "ready") return <Pending value={board} />;
  const rows = board.data.filter((card) => keep(card, filter));
  return (
    <div className="blueprint flex min-h-0 flex-1 flex-col bg-bg">
      {rows.length === 0 ? (
        <Empty>No project matches this filter.</Empty>
      ) : (
        <Scroller>
          <Table className="min-w-[880px] text-[13px]">
            <TableHeader>
              <tr>
                {COLUMNS.map((column) => (
                  <TableHead
                    key={column.label}
                    className={cn(column.numeric && "text-right")}
                  >
                    {column.label}
                  </TableHead>
                ))}
              </tr>
            </TableHeader>
            <TableBody>
              {rows.map((card) => (
                <Row key={card.slug} card={card} />
              ))}
            </TableBody>
          </Table>
        </Scroller>
      )}
    </div>
  );
}

import type { DueBadge, RatingPoint, SignalView } from "../data";
import { percent, tenths } from "./format";
import { Panel, Pending, useLoaded } from "./panel";

const LOW_RATING = 3;
const W = 320;
const H = 72;
const PAD = 4;

function sparkPath(points: RatingPoint[]): {
  line: string;
  area: string;
  xy: [number, number][];
} {
  if (points.length === 0) return { line: "", area: "", xy: [] };
  const step = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const xy = points.map<[number, number]>((p, i) => [
    PAD + i * step,
    H - PAD - ((p.rating - 1) / 9) * (H - PAD * 2),
  ]);
  const line = xy
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${xy.at(-1)?.[0].toFixed(1)} ${H} L${xy[0][0].toFixed(1)} ${H} Z`;
  return { line, area, xy };
}

function Sparkline({ points }: { points: RatingPoint[] }) {
  const { line, area, xy } = sparkPath(points);
  const last = xy.at(-1);
  const midY = H - PAD - (4 / 9) * (H - PAD * 2);
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="ratings"
    >
      <title>ratings, oldest to newest</title>
      <defs>
        <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f0b14a" stopOpacity="0.28" />
          <stop offset="1" stopColor="#f0b14a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line className="rule" x1={PAD} x2={W - PAD} y1={midY} y2={midY} />
      <path className="area" d={area} />
      <path className="line" d={line} />
      {points.map((p, i) =>
        p.rating <= LOW_RATING ? (
          <circle key={p.ts} className="low" cx={xy[i][0]} cy={xy[i][1]} r="2" />
        ) : null
      )}
      {last && <circle className="last" cx={last[0]} cy={last[1]} r="3" />}
    </svg>
  );
}

function Figure({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="figure">
      <div className={`value ${tone ?? ""}`}>{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

const BADGE_LOOK: Record<DueBadge["state"], { row: string; tag: string }> = {
  due: { row: "due", tag: "amber" },
  clear: { row: "clear", tag: "good" },
  "n/a": { row: "na", tag: "ghost" },
};

function Due({ name, badge }: { name: string; badge: DueBadge }) {
  const look = BADGE_LOOK[badge.state];
  return (
    <div className={`due-row ${look.row}`}>
      <span className={`tag ${look.tag}`}>{badge.state}</span>
      <span className="detail">
        {name}
        {badge.detail ? ` — ${badge.detail}` : ""}
      </span>
    </div>
  );
}

function ratingTone(avg: number): string {
  if (avg < 5) return "bad";
  if (avg >= 7) return "good";
  return "";
}

export function Signal() {
  const view = useLoaded<SignalView>("/api/signal");
  return (
    <Panel
      index="02 · feedback"
      title="Signal"
      span={4}
      order={1}
      aside={
        view.state === "ready" && view.data.synthesizedAt
          ? `synthesised ${view.data.synthesizedAt.slice(0, 10)}`
          : ""
      }
    >
      <Pending value={view} />
      {view.state === "ready" && (
        <>
          <div className="figures">
            <Figure
              value={view.data.ratings ? tenths(view.data.ratings.recentAvg) : "–"}
              label="last 10"
              tone={view.data.ratings ? ratingTone(view.data.ratings.recentAvg) : ""}
            />
            <Figure
              value={view.data.ratings ? tenths(view.data.ratings.avg) : "–"}
              label={`avg of ${view.data.ratings?.count ?? 0}`}
            />
            <Figure
              value={view.data.ratings ? String(view.data.ratings.lowCount) : "–"}
              label="low (≤3)"
              tone={view.data.ratings && view.data.ratings.lowCount > 5 ? "bad" : ""}
            />
          </div>
          {view.data.series.length > 0 ? (
            <Sparkline points={view.data.series} />
          ) : (
            <div className="empty">No ratings yet.</div>
          )}
          <div className="spark-caption">
            <span>last {view.data.series.length} ratings</span>
            <span>{view.data.ratings?.trend ?? ""}</span>
          </div>
          <div className="figures" style={{ marginTop: 16 }}>
            <Figure
              value={
                view.data.algorithm ? String(view.data.algorithm.reflectionCount) : "–"
              }
              label="reflections"
            />
            <Figure
              value={view.data.algorithm ? percent(view.data.algorithm.passRate) : "–"}
              label="criteria pass"
            />
            <Figure
              value={view.data.algorithm ? tenths(view.data.algorithm.avgSentiment) : "–"}
              label="sentiment"
            />
          </div>
          <div className="due">
            <Due name="learning analysis" badge={view.data.due.analysis} />
            <Due name="algorithm review" badge={view.data.due.algorithmReview} />
            <Due name="relationship reflect" badge={view.data.due.relationshipReflect} />
          </div>
        </>
      )}
    </Panel>
  );
}

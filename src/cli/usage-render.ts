import {
  type AgentReport,
  costLabel,
  fmt,
  fmtCost,
  grandBucket,
  inferenceLabel,
  modelLabel,
  modelsByCost,
  projectsByCost,
  type RtkGain,
  type UsageData,
  unpricedAgents,
  usageLines,
  usedAgents,
  usedInferenceModels,
  WINDOWS,
} from "../tools/lib/token-report";
import { type Bucket, type TimeBuckets, totalTokens } from "../tools/lib/usage-buckets";
import { mark } from "./ui/rail";
import type { Style } from "./ui/style";

const LABEL_WIDTH = 12;

interface RowCells {
  label: string;
  tokens: string;
  calls: string;
  cost: string;
}

function rowCells(style: Style, label: string, b: Bucket, width: number): RowCells {
  return {
    label: `    ${label.padEnd(width)}`,
    tokens: fmt(totalTokens(b)).padStart(9),
    calls: fmt(b.calls).padStart(7),
    cost: costLabel(b, style.glyph.dash).padStart(12),
  };
}

/** A window without calls fades whole, so the ones that spent stand out. */
function row(style: Style, label: string, b: Bucket, width = LABEL_WIDTH): string {
  const cells = rowCells(style, label, b, width);
  if (b.calls === 0)
    return style.dim(
      `${cells.label}${cells.tokens} tok${cells.calls} calls${cells.cost}`
    );
  const cost = b.unpriced === b.calls ? style.dim(cells.cost) : style.cmd(cells.cost);
  return [
    cells.label,
    style.soft(cells.tokens),
    style.dim(" tok"),
    style.soft(cells.calls),
    style.dim(" calls"),
    cost,
  ].join("");
}

const heading = (style: Style, text: string) => `  ${style.bold(style.gradient(text))}`;

const subtle = (style: Style, title: string, rest: string) =>
  heading(style, title) + style.dim(` ${style.glyph.dot} ${rest}`);

function windowRows(style: Style, buckets: TimeBuckets): string[] {
  return WINDOWS.map(([label, window]) => row(style, label, buckets[window]));
}

function agentSections(style: Style, agents: AgentReport[]): string[] {
  const used = usedAgents(agents);
  if (used.length === 0) return [`  ${style.dim("No agent usage recorded")}`, ""];
  return used.flatMap(({ label, usage }) => [
    heading(style, label),
    ...windowRows(style, usage.buckets),
    "",
  ]);
}

function modelSection(style: Style, agents: AgentReport[]): string[] {
  const sorted = modelsByCost(agents);
  if (sorted.length === 0) return [];
  const names = sorted.map(([model]) => modelLabel(model));
  const width = Math.max(LABEL_WIDTH, ...names.map((name) => name.length + 2));
  return [
    subtle(style, "By model", "all time"),
    ...sorted.map(([, bucket], i) => row(style, names[i], bucket, width)),
    "",
  ];
}

function projectSection(style: Style, agents: AgentReport[]): string[] {
  const sorted = projectsByCost(agents);
  if (sorted.length === 0) return [];
  const width = Math.max(LABEL_WIDTH, ...sorted.map(([name]) => name.length + 2));
  return [
    subtle(style, "By project", "all time"),
    ...sorted.map(([project, buckets]) => row(style, project, buckets.total, width)),
    "",
  ];
}

function inferenceSections(style: Style, data: UsageData): string[] {
  return usedInferenceModels(data.pal).flatMap(([model, buckets]) => [
    subtle(style, "PAL inference", inferenceLabel(model)),
    ...windowRows(style, buckets),
    "",
  ]);
}

function rtkLine(style: Style, gain: RtkGain): string {
  const summary = gain.summary;
  if (!gain.installed) return style.dim("not installed");
  if (!summary || summary.total_commands === 0)
    return style.dim("installed, no savings recorded yet");
  const dot = ` ${style.dim(style.glyph.dot)} `;
  const average = `${summary.avg_savings_pct.toFixed(1)}%`;
  return [
    `${style.soft(fmt(summary.total_saved))}${style.dim(" tokens saved")}`,
    `${style.soft(average)}${style.dim(" avg")}`,
    `${style.soft(fmt(summary.total_commands))}${style.dim(" commands")}`,
  ].join(dot);
}

function rtkSection(style: Style, gain: RtkGain): string[] {
  return [subtle(style, "rtk", "compression"), `    ${rtkLine(style, gain)}`, ""];
}

function noteLines(style: Style, data: UsageData): string[] {
  const join = (names: string[]) => names.join(` ${style.glyph.dot} `);
  const unpriced = unpricedAgents(data.agents);
  return [
    ...(data.untracked.length > 0
      ? [
          `  ${mark(style, "info")} ${style.soft(join(data.untracked))} ${style.dim("keep no token counts")}`,
        ]
      : []),
    ...(unpriced.length > 0
      ? [
          `  ${mark(style, "info")} ${style.soft(join(unpriced))} ${style.dim("bill without a per-token price, so the total leaves them out")}`,
        ]
      : []),
  ];
}

function headline(style: Style, data: UsageData): string {
  const agents = usedAgents(data.agents).map((agent) => agent.label);
  const names = agents.length > 0 ? agents.join(` ${style.glyph.dot} `) : "no agent";
  const total = style.bold(style.cmd(fmtCost(grandBucket(data).cost)));
  return `  ${mark(style, "ask")} ${style.gradient("PAL usage")}  ${total}  ${style.soft(names)}`;
}

function richLines(style: Style, data: UsageData): string[] {
  const notes = noteLines(style, data);
  return [
    "",
    headline(style, data),
    "",
    ...agentSections(style, data.agents),
    ...modelSection(style, data.agents),
    ...projectSection(style, data.agents),
    ...inferenceSections(style, data),
    ...rtkSection(style, data.rtk),
    ...(notes.length > 0 ? [...notes, ""] : []),
  ];
}

export function renderUsage(style: Style, data: UsageData): string[] {
  return style.term.rich ? richLines(style, data) : usageLines(data);
}

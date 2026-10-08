import { AGENT_REGISTRY, type AgentName } from "../../hooks/lib/agent-registry";
import { healthBadge, mark, seconds } from "../ui/rail";
import { homeShortened, type Style, visibleWidth } from "../ui/style";
import { wrapWords } from "../ui/wrap";
import type { Finding, Fix, Group, Severity } from "./finding";

export interface DoctorReport {
  version: string;
  agents: string[];
  findings: Finding[];
  elapsedMs?: number;
}

interface RenderOptions {
  verbose: boolean;
  style: Style;
}

export interface Tally {
  fails: Finding[];
  warns: Finding[];
  optionals: Finding[];
  passes: Finding[];
}

export function tally(findings: Finding[]): Tally {
  const of = (severity: Severity) => findings.filter((f) => f.severity === severity);
  return {
    fails: of("fail"),
    warns: of("warn"),
    optionals: of("optional"),
    passes: of("ok"),
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function plainSummary({ fails, warns, passes }: Tally): string {
  return [
    fails.length > 0 ? `${fails.length} failing` : "",
    warns.length > 0 ? plural(warns.length, "warning") : "",
    `${plural(passes.length, "check")} passed`,
  ]
    .filter(Boolean)
    .join(", ");
}

const PLAIN_LEVEL: Record<Severity, string> = {
  fail: "fail",
  warn: "warn",
  optional: "optional",
  ok: "ok  ",
};

function fixText(fix: Fix): string {
  return fix.command ? `${fix.say}: ${fix.command}` : fix.say;
}

function plainLine(finding: Finding): string {
  const fix = finding.fix ? ` -> ${fixText(finding.fix)}` : "";
  return `${PLAIN_LEVEL[finding.severity]} ${finding.title}${fix}`;
}

export function plainProblemLines(t: Tally): string[] {
  return [...t.fails, ...t.warns].map(plainLine);
}

function plainReport(report: DoctorReport, verbose: boolean): string[] {
  const t = tally(report.findings);
  const agents = report.agents.length > 0 ? report.agents.join(", ") : "no agent";
  return [
    `PAL ${report.version} · ${agents} · ${plainSummary(t)}`,
    ...(verbose ? t.passes.map(plainLine) : []),
    ...plainProblemLines(t),
    ...t.optionals.map(plainLine),
  ];
}

const TITLE_REST = " — ";

interface Segment {
  text: string;
  paint: (text: string) => string;
}

const asIs = (text: string) => text;

/** Wraps the words of several differently coloured pieces as if they were one sentence. */
export function wrapSegments(segments: Segment[], width: number): string[] {
  const text = segments.map((s) => s.text).join("");
  let end = 0;
  const bounds = segments.map((s) => {
    end += s.text.length;
    return end;
  });
  return wrapWords(text, width).map(({ text: chunk, start }) =>
    segments
      .map((segment, i) => {
        const from = Math.max(start, bounds[i - 1] ?? 0);
        const to = Math.min(start + chunk.length, bounds[i]);
        return to > from ? segment.paint(text.slice(from, to)) : "";
      })
      .join("")
  );
}

/** A title reads "what — more about it"; the part after the dash is quieter. */
function titleSegments(
  style: Style,
  title: string,
  main: (text: string) => string,
  separator = TITLE_REST
): Segment[] {
  const text = homeShortened(title);
  const split = text.indexOf(TITLE_REST);
  if (split < 0) return [{ text, paint: main }];
  return [
    { text: text.slice(0, split), paint: main },
    { text: `${separator}${text.slice(split + TITLE_REST.length)}`, paint: style.dim },
  ];
}

function hanging(lines: string[], first: string, rest: string): string[] {
  return lines.map((line, i) => `${i === 0 ? first : rest}${line}`);
}

function fixLines(style: Style, fix: Fix, width: number, indent: string): string[] {
  const arrow = `${indent}${style.dim(style.glyph.arrow)} `;
  const pad = " ".repeat(indent.length + style.glyph.arrow.length + 1);
  const segment = fix.command
    ? { text: fix.command, paint: style.cmd }
    : { text: homeShortened(fix.say), paint: asIs };
  return hanging(wrapSegments([segment], width), arrow, pad);
}

const textWidth = (style: Style, indent: string) =>
  Math.max(30, style.term.width - indent.length - 4);

export function problemLines(style: Style, t: Tally, indent = "  "): string[] {
  const width = textWidth(style, indent);
  return [...t.fails, ...t.warns].flatMap((problem) => {
    const kind = problem.severity === "fail" ? "fail" : "warn";
    const main = kind === "fail" ? style.bold : asIs;
    const head = `${indent}${mark(style, kind)} `;
    return [
      ...hanging(
        wrapSegments(titleSegments(style, problem.title, main), width),
        head,
        `${indent}  `
      ),
      ...(problem.fix ? fixLines(style, problem.fix, width, `${indent}  `) : []),
    ];
  });
}

function optionalLines(style: Style, item: Finding): string[] {
  const name = homeShortened(item.title.split(TITLE_REST)[0]);
  const how = item.fix?.command
    ? { text: item.fix.command, paint: style.cmd }
    : { text: homeShortened(item.fix?.say ?? ""), paint: style.dim };
  const segments = [
    { text: name, paint: style.soft },
    { text: ` ${style.glyph.dash} `, paint: style.dim },
    how,
  ];
  return hanging(
    wrapSegments(segments, textWidth(style, "  ")),
    `  ${style.dim(style.glyph.dot)} `,
    "    "
  );
}

const GROUP_ORDER: Group[] = ["Environment", "Agents", "Inference", "State"];

function agentOf(finding: Finding, agents: string[]): string | undefined {
  return agents.find((agent) => finding.id.startsWith(`${agent}.`));
}

function passLines(style: Style, finding: Finding): string[] {
  const segments = titleSegments(style, finding.title, asIs, ` ${style.glyph.dot} `);
  return hanging(
    wrapSegments(segments, textWidth(style, "  ")),
    `  ${mark(style, "ok")} `,
    "    "
  );
}

function agentLines(style: Style, agent: string, passes: Finding[]): string[] {
  const label = (AGENT_REGISTRY[agent as AgentName]?.label ?? agent).padEnd(12);
  const briefs = passes.map((f) => f.brief ?? f.title).join(` ${style.glyph.dot} `);
  const width = textWidth(style, "  ") - label.length - 1;
  return hanging(
    wrapSegments([{ text: briefs, paint: style.dim }], width),
    `  ${mark(style, "ok")} ${label} `,
    " ".repeat(label.length + 5)
  );
}

function groupLines(style: Style, group: Group, passes: Finding[], agents: string[]) {
  const inGroup = passes.filter((f) => (f.group ?? "State") === group);
  if (inGroup.length === 0) return [];
  const own = inGroup.filter((f) => !agentOf(f, agents));
  const perAgent = agents
    .map((agent) => [agent, inGroup.filter((f) => agentOf(f, agents) === agent)] as const)
    .filter(([, found]) => found.length > 0);
  return [
    `  ${style.bold(style.gradient(group))}`,
    ...own.flatMap((f) => passLines(style, f)),
    ...perAgent.flatMap(([agent, found]) => agentLines(style, agent, found)),
    "",
  ];
}

function headline(style: Style, t: Tally, report: DoctorReport): string[] {
  const count = { fails: t.fails.length, warns: t.warns.length };
  const agents = style.soft(
    report.agents.length > 0 ? report.agents.join(` ${style.glyph.dot} `) : "no agent"
  );
  const pal = style.bold(`PAL ${report.version}`);
  const head = `  ${healthBadge(style, count, true)}  ${pal}`;
  const oneLine = `${head}  ${agents}`;
  return visibleWidth(oneLine) <= style.term.width ? [oneLine] : [head, `  ${agents}`];
}

function richReport(report: DoctorReport, verbose: boolean, style: Style): string[] {
  const t = tally(report.findings);
  const elapsed =
    report.elapsedMs === undefined
      ? ""
      : ` ${style.glyph.dot} ${seconds(report.elapsedMs)}`;
  const footer = `${plural(t.passes.length, "check")} passed${elapsed}`;
  const problems = problemLines(style, t);
  return [
    "",
    ...headline(style, t, report),
    "",
    ...(verbose
      ? GROUP_ORDER.flatMap((g) => groupLines(style, g, t.passes, report.agents))
      : []),
    ...(problems.length > 0 ? [...problems, ""] : []),
    ...(t.optionals.length > 0
      ? [
          `  ${style.dim("Optional")}`,
          ...t.optionals.flatMap((o) => optionalLines(style, o)),
          "",
        ]
      : []),
    `  ${style.dim(footer)}`,
    "",
  ];
}

export function renderReport(report: DoctorReport, options: RenderOptions): string[] {
  return options.style.term.rich
    ? richReport(report, options.verbose, options.style)
    : plainReport(report, options.verbose);
}

export function doctorExitCode(findings: Finding[]): 0 | 1 {
  return findings.some((finding) => finding.severity === "fail") ? 1 : 0;
}

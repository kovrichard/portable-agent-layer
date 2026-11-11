#!/usr/bin/env bun
import { extname } from "node:path";
import { parseArgs as parseFlags } from "node:util";

const USAGE = `Usage: pal cli skill run pareto-analyze pareto <file.csv|file.json> [flags]

  --unit <column>      column that names the unit (default: unit)
  --value <column>     column that holds the number (default: value)
  --group-by <column>  also print totals per value of this trait column; repeatable
  --cutoff <percent>   cumulative share that ends the top set (default: 80)
  --limit <rows>       unit rows to print before collapsing the rest; 0 prints all (default: 30)

Rows that name the same unit are summed. A column named "evidence" is carried into the table.`;

const UNKNOWN = "(unknown)";
const MIXED = "(mixed)";
const EVIDENCE_COLUMN = "evidence";
const CSV_FIELD = /("(?:[^"]|"")*"|[^",\r\n]*)(,|\r?\n|$)/g;

type Row = Record<string, string>;

export interface Options {
  file: string;
  unitColumn: string;
  valueColumn: string;
  groupBy: string[];
  cutoffPercent: number;
  limit: number;
}

interface Unit {
  name: string;
  n: number;
  value: number;
  share: number;
  cumulative: number;
  rows: Row[];
}

interface Group {
  name: string;
  units: number;
  inCutoff: number;
  value: number;
  share: number;
  cumulative: number;
}

class InputError extends Error {}

function numberFlag(name: string, raw: string, min: number, max: number): number {
  const parsed = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new InputError(
      `--${name} must be a number from ${min} to ${max}, got "${raw}"`
    );
  }
  return parsed;
}

export function parseArgs(argv: string[]): Options {
  const { values, positionals } = parseFlags({
    args: argv,
    allowPositionals: true,
    options: {
      unit: { type: "string", default: "unit" },
      value: { type: "string", default: "value" },
      "group-by": { type: "string", multiple: true, default: [] },
      cutoff: { type: "string", default: "80" },
      limit: { type: "string", default: "30" },
    },
  });
  const [file] = positionals;
  if (!file || positionals.length > 1) throw new InputError(USAGE);
  const cutoffPercent = numberFlag("cutoff", values.cutoff, 0, 100);
  if (cutoffPercent === 0) throw new InputError("--cutoff must be above 0");
  return {
    file,
    unitColumn: values.unit,
    valueColumn: values.value,
    groupBy: values["group-by"],
    cutoffPercent,
    limit: Math.floor(numberFlag("limit", values.limit, 0, Number.MAX_SAFE_INTEGER)),
  };
}

function unquoted(field: string): string {
  if (!field.startsWith('"')) return field.trim();
  return field.slice(1, -1).replaceAll('""', '"');
}

function csvRecords(text: string): string[][] {
  const records: string[][] = [[]];
  let consumed = 0;
  for (const [whole, field = "", end] of text.matchAll(CSV_FIELD)) {
    consumed += whole.length;
    records.at(-1)?.push(unquoted(field));
    if (end !== ",") records.push([]);
  }
  if (consumed !== text.length) {
    throw new InputError("Malformed CSV: a quoted field is not closed or not delimited");
  }
  return records.filter((record) => record.some((cell) => cell !== ""));
}

function rowFromRecord(header: string[], record: string[], line: number): Row {
  if (record.length !== header.length) {
    throw new InputError(
      `CSV record ${line} has ${record.length} cells, the header has ${header.length}`
    );
  }
  return Object.fromEntries(header.map((column, i) => [column, record[i] ?? ""]));
}

function parseCsv(text: string): Row[] {
  const [header, ...records] = csvRecords(text.replace(/^﻿/, ""));
  if (!header) return [];
  return records.map((record, i) => rowFromRecord(header, record, i + 2));
}

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  return typeof cell === "object" ? JSON.stringify(cell) : String(cell).trim();
}

function parseJson(text: string): Row[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new InputError(`Invalid JSON: ${(error as Error).message}`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "object" || !item)
  ) {
    throw new InputError("JSON input must be an array of objects, one per row");
  }
  return parsed.map((item: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(item).map(([key, cell]) => [key, cellText(cell)]))
  );
}

export function parseRows(fileName: string, text: string): Row[] {
  const rows =
    extname(fileName).toLowerCase() === ".json" ? parseJson(text) : parseCsv(text);
  if (rows.length === 0) throw new InputError(`${fileName} holds no data rows`);
  return rows;
}

function requireColumn(rows: Row[], column: string): void {
  const columns = Object.keys(rows[0] ?? {});
  if (!columns.includes(column)) {
    throw new InputError(`No column "${column}". Columns: ${columns.join(", ")}`);
  }
}

function numberIn(row: Row, options: Options, line: number): number {
  const raw = row[options.valueColumn] ?? "";
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value)) {
    throw new InputError(
      `Row ${line}: "${raw}" in column "${options.valueColumn}" is not a number`
    );
  }
  if (value < 0) {
    throw new InputError(
      `Row ${line}: negative value ${raw}. Shares need one direction: analyze gains and losses in separate runs`
    );
  }
  return value;
}

function sumPerUnit(rows: Row[], options: Options): Unit[] {
  const units = new Map<string, Unit>();
  rows.forEach((row, i) => {
    const name = row[options.unitColumn]?.trim() || UNKNOWN;
    const unit = units.get(name) ?? {
      name,
      n: 0,
      value: 0,
      share: 0,
      cumulative: 0,
      rows: [],
    };
    unit.n += 1;
    unit.value += numberIn(row, options, i + 1);
    unit.rows.push(row);
    units.set(name, unit);
  });
  return [...units.values()];
}

function byValueThenName(a: { value: number; name: string }, b: typeof a): number {
  return b.value - a.value || a.name.localeCompare(b.name);
}

function withShares<T extends { value: number; share: number; cumulative: number }>(
  sorted: T[],
  total: number
): T[] {
  let running = 0;
  for (const entry of sorted) {
    running += entry.value;
    entry.share = (entry.value / total) * 100;
    entry.cumulative = (running / total) * 100;
  }
  return sorted;
}

export function rankUnits(rows: Row[], options: Options): Unit[] {
  requireColumn(rows, options.unitColumn);
  requireColumn(rows, options.valueColumn);
  const units = sumPerUnit(rows, options).sort(byValueThenName);
  const total = units.reduce((sum, unit) => sum + unit.value, 0);
  if (total <= 0) throw new InputError("Every value is 0: there is nothing to rank");
  return withShares(units, total);
}

export function cutoffCount(
  ranked: { cumulative: number }[],
  cutoffPercent: number
): number {
  const index = ranked.findIndex((entry) => entry.cumulative >= cutoffPercent - 1e-9);
  return index === -1 ? ranked.length : index + 1;
}

export function shapeOf(topCount: number, unitCount: number): string {
  const unitShare = topCount / unitCount;
  if (unitShare <= 1 / 3) return "concentrated";
  if (unitShare <= 1 / 2) return "weak";
  return "flat";
}

function traitOf(unit: Unit, column: string): string {
  const distinct = new Set(unit.rows.map((row) => row[column]?.trim() || UNKNOWN));
  return distinct.size === 1 ? [...distinct].join("") : MIXED;
}

export function groupTotals(ranked: Unit[], column: string, topCount: number): Group[] {
  const groups = new Map<string, Group>();
  ranked.forEach((unit, i) => {
    const name = traitOf(unit, column);
    const group = groups.get(name) ?? {
      name,
      units: 0,
      inCutoff: 0,
      value: 0,
      share: 0,
      cumulative: 0,
    };
    group.units += 1;
    group.inCutoff += i < topCount ? 1 : 0;
    group.value += unit.value;
    groups.set(name, group);
  });
  const total = ranked.reduce((sum, unit) => sum + unit.value, 0);
  return withShares([...groups.values()].sort(byValueThenName), total);
}

function amount(value: number): string {
  return String(Number(value.toFixed(2)));
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function tableOf(header: string[], lines: string[][]): string {
  const asLine = (cells: string[]) =>
    `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
  return [asLine(header), asLine(header.map(() => "---")), ...lines.map(asLine)].join(
    "\n"
  );
}

function evidenceOf(unit: Unit): string {
  const distinct = new Set(unit.rows.map((row) => row[EVIDENCE_COLUMN] ?? ""));
  return [...distinct].filter(Boolean).join("; ");
}

function unitTable(ranked: Unit[], options: Options, topCount: number): string {
  const hasEvidence = ranked.some((unit) => EVIDENCE_COLUMN in (unit.rows[0] ?? {}));
  const shown = options.limit === 0 ? ranked : ranked.slice(0, options.limit);
  const lines = shown.map((unit, i) => [
    String(i + 1),
    unit.name,
    String(unit.n),
    amount(unit.value),
    percent(unit.share),
    percent(unit.cumulative),
    i + 1 === topCount ? `<-- ${amount(options.cutoffPercent)}%` : "",
    ...(hasEvidence ? [evidenceOf(unit)] : []),
  ]);
  const rest = ranked.slice(shown.length);
  if (rest.length > 0) {
    const restValue = rest.reduce((sum, unit) => sum + unit.value, 0);
    const restShare = rest.reduce((sum, unit) => sum + unit.share, 0);
    const restRows = rest.reduce((sum, unit) => sum + unit.n, 0);
    lines.push([
      "",
      `(remaining ${rest.length} units)`,
      String(restRows),
      amount(restValue),
      percent(restShare),
      percent(100),
      "",
      ...(hasEvidence ? [""] : []),
    ]);
  }
  const header = [
    "#",
    options.unitColumn,
    "n",
    options.valueColumn,
    "share",
    "cumulative",
  ];
  return tableOf(
    [...header, "cut-off", ...(hasEvidence ? [EVIDENCE_COLUMN] : [])],
    lines
  );
}

function groupSection(ranked: Unit[], column: string, topCount: number): string {
  const groups = groupTotals(ranked, column, topCount);
  const unknownShare = groups.find((group) => group.name === UNKNOWN)?.share ?? 0;
  const lines = groups.map((group) => [
    group.name,
    String(group.units),
    String(group.inCutoff),
    amount(group.value),
    percent(group.share),
    percent(group.cumulative),
  ]);
  const header = [column, "units", "units in top set", "value", "share", "cumulative"];
  return [
    `Grouped by \`${column}\`:`,
    "",
    tableOf(header, lines),
    "",
    `Unknown share for \`${column}\`: ${percent(unknownShare)}`,
  ].join("\n");
}

export function report(rows: Row[], options: Options): string {
  const ranked = rankUnits(rows, options);
  options.groupBy.forEach((column) => {
    requireColumn(rows, column);
  });
  const topCount = cutoffCount(ranked, options.cutoffPercent);
  const total = ranked.reduce((sum, unit) => sum + unit.value, 0);
  const last = ranked[topCount - 1];
  const summary = [
    `Total ${options.valueColumn}: ${amount(total)} across ${ranked.length} units (${rows.length} rows).`,
    `Cut-off: ${topCount} of ${ranked.length} units (${percent((topCount / ranked.length) * 100)} of units) reach ${percent(last?.cumulative ?? 100)} of the total (target ${amount(options.cutoffPercent)}%).`,
    `Shape: ${shapeOf(topCount, ranked.length)}.`,
  ].join("\n");
  const groupSections = options.groupBy.map((column) =>
    groupSection(ranked, column, topCount)
  );
  return [unitTable(ranked, options, topCount), summary, ...groupSections].join("\n\n");
}

async function run(): Promise<void> {
  try {
    const options = parseArgs(Bun.argv.slice(2));
    const text = await Bun.file(options.file).text();
    console.log(report(parseRows(options.file, text), options));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.main) await run();

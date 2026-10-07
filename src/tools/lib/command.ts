/**
 * The `pal cli` command tree. A command declares its arguments and flags once;
 * that declaration drives the parser, the `--help` page and the error a wrong
 * call gets, so the three cannot drift apart.
 */

import { type ParseArgsOptionDescriptor, parseArgs } from "node:util";

export interface OptionSpec extends ParseArgsOptionDescriptor {
  description: string;
  value?: string;
}

export type OptionSpecs = Record<string, OptionSpec>;

type ParsedValues<O extends OptionSpecs> = ReturnType<
  typeof parseArgs<{ options: O; allowPositionals: true; strict: true }>
>["values"];

export interface CommandInput<O extends OptionSpecs = OptionSpecs> {
  values: ParsedValues<O>;
  positionals: string[];
  passedThrough: string[];
  argv: string[];
}

export interface LeafSpec<O extends OptionSpecs> {
  summary: string;
  args?: string;
  options?: O;
  details?: string;
  passThrough?: boolean;
  run(input: CommandInput<O>): unknown;
}

export interface Leaf extends Omit<LeafSpec<OptionSpecs>, "run"> {
  kind: "leaf";
  run(input: CommandInput): unknown;
}

export interface Group {
  kind: "group";
  summary: string;
  commands: Record<string, Command>;
  aliases?: Record<string, string>;
  fallback?: string;
  details?: string;
}

export type Command = Leaf | Group;

export class UsageError extends Error {}

export function leaf<const O extends OptionSpecs = Record<never, OptionSpec>>(
  spec: LeafSpec<O>
): Leaf {
  return { kind: "leaf", ...spec } as unknown as Leaf;
}

export function group(spec: Omit<Group, "kind">): Group {
  return { kind: "group", ...spec };
}

const HELP_FLAGS = new Set(["-h", "--help"]);
const HELP_OPTION: OptionSpec = {
  type: "boolean",
  short: "h",
  description: "Show this help",
};

export async function runCommand(
  command: Command,
  args: string[],
  path: string[]
): Promise<number> {
  return command.kind === "group"
    ? runGroup(command, args, path)
    : runLeaf(command, args, path);
}

async function runGroup(command: Group, args: string[], path: string[]): Promise<number> {
  const [first, ...rest] = args;
  const name = first === undefined ? command.fallback : first;
  if (name === undefined || name === "help" || HELP_FLAGS.has(name)) {
    console.log(helpText(command, path));
    return 0;
  }
  const resolved = command.aliases?.[name] ?? name;
  const sub = command.commands[resolved];
  if (!sub) return usageFailure(`unknown command '${name}'`, command, path);
  return runCommand(sub, rest, [...path, resolved]);
}

async function runLeaf(command: Leaf, args: string[], path: string[]): Promise<number> {
  const { head, passedThrough } = splitPassThrough(command, args);
  if (head.some((arg) => HELP_FLAGS.has(arg))) {
    console.log(helpText(command, path));
    return 0;
  }
  try {
    const { values, positionals } = parseWithTextShielded(head, command.options ?? {});
    checkPositionals(command.args, positionals);
    return exitCode(
      await command.run({ values, positionals, passedThrough, argv: head })
    );
  } catch (error) {
    if (!isUsageError(error)) throw error;
    const message =
      error instanceof UsageError ? error.message : firstSentence(error.message);
    return usageFailure(message, command, path);
  }
}

const SHIELD = "\u0000text:";

function isFreeText(arg: string): boolean {
  return /\s/.test(arg);
}

function parseWithTextShielded(args: string[], options: OptionSpecs) {
  const unshield = (value: string) =>
    value.startsWith(SHIELD)
      ? (args[Number(value.slice(SHIELD.length))] ?? value)
      : value;
  const unshieldValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(unshieldValue);
    return typeof value === "string" ? unshield(value) : value;
  };
  const parsed = parseArgs({
    args: args.map((arg, index) => (isFreeText(arg) ? `${SHIELD}${index}` : arg)),
    options,
    allowPositionals: true,
    strict: true,
  });
  const values = Object.fromEntries(
    Object.entries(parsed.values).map(([key, value]) => [key, unshieldValue(value)])
  ) as typeof parsed.values;
  return { values, positionals: parsed.positionals.map(unshield) };
}

function exitCode(result: unknown): number {
  return typeof result === "number" ? result : 0;
}

function firstSentence(message: string): string {
  return message.split(/\.\s/)[0] ?? message;
}

function splitPassThrough(
  command: Leaf,
  args: string[]
): { head: string[]; passedThrough: string[] } {
  const at = command.passThrough
    ? passThroughStart(args, argSlots(command.args))
    : args.length;
  const tail = args.slice(at);
  return {
    head: args.slice(0, at),
    passedThrough: tail[0] === "--" ? tail.slice(1) : tail,
  };
}

function passThroughStart(args: string[], slots: ArgSlot[]): number {
  let filled = 0;
  for (const [index, arg] of args.entries()) {
    if (arg === "--") return index;
    if (!arg.startsWith("-")) filled += 1;
    if (filled === slots.length) return index + 1;
  }
  return args.length;
}

function isUsageError(error: unknown): error is Error {
  if (error instanceof UsageError) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_");
}

function usageFailure(message: string, command: Command, path: string[]): number {
  console.error(`error: ${message}\n\n${helpText(command, path)}`);
  return 1;
}

interface ArgSlot {
  name: string;
  required: boolean;
  variadic: boolean;
}

function argSlots(synopsis: string | undefined): ArgSlot[] {
  return (synopsis ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ({
      name: token,
      required: token.startsWith("<"),
      variadic: token.includes("..."),
    }));
}

function checkPositionals(synopsis: string | undefined, positionals: string[]): void {
  const slots = argSlots(synopsis);
  const missing = slots.filter((slot) => slot.required)[positionals.length];
  if (missing) throw new UsageError(`missing ${missing.name}`);
  if (slots.some((slot) => slot.variadic)) return;
  const extra = positionals[slots.length];
  if (extra !== undefined) throw new UsageError(`unexpected argument '${extra}'`);
}

export function helpText(command: Command, path: string[]): string {
  return command.kind === "group" ? groupHelp(command, path) : leafHelp(command, path);
}

function leafHelp(command: Leaf, path: string[]): string {
  const options = { ...command.options, help: HELP_OPTION };
  const synopsis = [
    ...path,
    ...(command.args ? [command.args] : []),
    ...(command.options && Object.keys(command.options).length ? ["[options]"] : []),
    ...(command.passThrough ? ["[<passed-on>...]"] : []),
  ].join(" ");
  const rows = Object.entries(options).map(
    ([name, spec]) => [optionLabel(name, spec), spec.description] as const
  );
  return [
    `Usage: ${synopsis}`,
    "",
    `  ${command.summary}`,
    "",
    "Options:",
    ...table(rows),
    ...(command.details ? ["", command.details.trimEnd()] : []),
  ].join("\n");
}

function optionLabel(name: string, spec: OptionSpec): string {
  const short = spec.short ? `-${spec.short}, ` : "";
  const value = spec.type === "string" ? ` ${spec.value ?? "<value>"}` : "";
  return `${short}--${name}${value}`;
}

function groupHelp(command: Group, path: string[]): string {
  const placeholder = command.fallback ? "[<command>]" : "<command>";
  const rows = Object.entries(command.commands).map(
    ([name, sub]) => [commandLabel(name, sub, command), sub.summary] as const
  );
  const fallbackNote = command.fallback
    ? [`With no command, runs '${command.fallback}'.`]
    : [];
  return [
    `Usage: ${[...path, placeholder].join(" ")}`,
    "",
    `  ${command.summary}`,
    "",
    "Commands:",
    ...table(rows),
    "",
    ...fallbackNote,
    `Run '${path.join(" ")} <command> --help' for its arguments and options.`,
    ...(command.details ? ["", command.details.trimEnd()] : []),
  ].join("\n");
}

function commandLabel(name: string, sub: Command, parent: Group): string {
  const aliases = Object.entries(parent.aliases ?? {})
    .filter(([, target]) => target === name)
    .map(([alias]) => alias);
  const names = [name, ...aliases].join(" | ");
  return sub.kind === "leaf" && sub.args ? `${names} ${sub.args}` : names;
}

function table(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, text]) => `  ${label.padEnd(width)}  ${text}`);
}

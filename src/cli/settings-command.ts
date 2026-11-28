/**
 * settings.json through pal cli: the agent may not edit the file, and every
 * change is a decision in bronze (principle 5), its old and new value as event text.
 */

import { appendEvent } from "../bronze/events";
import {
  type PalSettingsData,
  raw as readSettings,
  write as writeSettings,
} from "../core/settings";
import { group, leaf, UsageError } from "../tools/lib/command";
import { readSettingsSchema, unknownSettingsKeys } from "./doctor/state";

type Tree = Record<string, unknown>;

const isTree = (value: unknown): value is Tree =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function valueAt(data: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((node, part) => (isTree(node) ? node[part] : undefined), data);
}

export function withValueAt(data: Tree, key: string, value: unknown): Tree {
  const [head, ...rest] = key.split(".");
  const child = isTree(data[head]) ? (data[head] as Tree) : {};

  return {
    ...data,
    [head]: rest.length === 0 ? value : withValueAt(child, rest.join("."), value),
  };
}

/** JSON when it parses (true, 3, {"a":1}), the plain text otherwise. */
function parsedValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The schema leaves its top level open, so a new top-level key must be one it declares or the file already has. */
function unknownTopLevel(key: string, before: Tree, declared: string[]): string[] {
  const top = key.split(".")[0];

  return top in before || declared.includes(top) ? [] : [top];
}

function newUnknownKeys(key: string, before: Tree, after: Tree): string[] {
  const schema = readSettingsSchema();
  if (!schema) return [];
  const known = new Set(unknownSettingsKeys(before, schema).map((k) => k.path));
  const nested = unknownSettingsKeys(after, schema)
    .filter((k) => !known.has(k.path))
    .map((k) => (k.suggestion ? `${k.path} (did you mean ${k.suggestion}?)` : k.path));

  return [
    ...unknownTopLevel(key, before, Object.keys(schema.properties ?? {})),
    ...nested,
  ];
}

export function setSetting(
  key: string,
  text: string
): { previous: unknown; value: unknown } {
  const before = readSettings() as Tree;
  const value = parsedValue(text);
  const after = withValueAt(before, key, value);
  const unknown = newUnknownKeys(key, before, after);
  if (unknown.length > 0) throw new UsageError(`unknown setting: ${unknown.join(", ")}`);
  const previous = valueAt(before, key);
  writeSettings(after as PalSettingsData);
  appendEvent("setting", { key, change: "set" }, { content: { value, previous } });

  return { previous, value };
}

export const settingsCommand = group({
  summary: "Read and change PAL's settings; each change is recorded",
  commands: {
    get: leaf({
      summary: "Print one setting by its dotted key, or all of them",
      args: "[key]",
      run: ({ positionals: [key] }) =>
        console.log(
          JSON.stringify(key ? valueAt(readSettings(), key) : readSettings(), null, 2)
        ),
    }),
    set: leaf({
      summary: "Set one setting by its dotted key; the value is JSON when it parses",
      args: "<key> <value...>",
      run: ({ positionals: [key, ...value] }) =>
        console.log(
          JSON.stringify({ key, ...setSetting(key, value.join(" ")) }, null, 2)
        ),
    }),
  },
});

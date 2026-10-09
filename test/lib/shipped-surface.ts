/**
 * What a PAL install leaves on a machine, as one sorted list of strings:
 *
 *   .claude/CLAUDE.md                                  a file
 *   .claude/skills/think -> {root}/home/skills/think   a link and its target
 *   home/memory/pal-settings.json#dynamicContext.wisdom  a config key
 *   .claude/settings.json#permissions.allow[]=Read(//*)  a string in a config list
 *   .codex/hooks.json#hook=LoadContext.ts               a hook script a config runs
 *
 * {root} is the sandbox and {pkg} the package, so the list reads the same anywhere.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { linkDir, linkFile } from "./links";

export const ROOTS = [
  ".agents",
  ".claude",
  ".codex",
  ".copilot",
  ".cursor",
  ".opencode",
  "home",
];

const CONFIGS = [
  "home/memory/pal-settings.json",
  ".claude/settings.json",
  ".cursor/cli-config.json",
  ".opencode/config.json",
  ".codex/config.toml",
];

const HOOK_CONFIGS = [
  ".claude/settings.json",
  ".codex/hooks.json",
  ".cursor/hooks.json",
  ".copilot/hooks/pal-hooks.json",
];

const NOT_SURFACE = [
  /^home\/docs\//,
  /^home\/telos\//,
  /^home\/memory\/actors\//,
  /^home\/debug\/debug\.log(\.\d)?$/,
  /\/node_modules\//,
  /\/bun\.lock$/,
  /\.bak\.\d+$/,
];

const HOOK_SCRIPT = /[\\/]src[\\/]hooks[\\/]([\w-]+\.ts)/g;

type Json = Record<string, unknown>;

function normalised(text: string, root: string, pkg: string): string {
  return text.replaceAll(root, "{root}").replaceAll(pkg, "{pkg}");
}

function concrete(text: string, root: string, pkg: string): string {
  return text.replaceAll("{pkg}", pkg).replaceAll("{root}", root);
}

function walk(root: string, dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = resolve(dir, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) return walk(root, path);
    return [relative(root, path)];
  });
}

function fileItem(root: string, pkg: string, rel: string): string {
  const path = resolve(root, rel);
  if (!lstatSync(path).isSymbolicLink()) return rel;
  return `${rel} -> ${normalised(readlinkSync(path), root, pkg)}`;
}

function isPlainObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keyItems(file: string, value: unknown, path: string): string[] {
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === "string")
  )
    return value.map((entry) => `${file}#${path}[]=${entry}`);
  if (isPlainObject(value) && Object.keys(value).length > 0)
    return Object.entries(value).flatMap(([key, child]) =>
      keyItems(file, child, path ? `${path}.${key}` : key)
    );
  return [`${file}#${path}`];
}

function parseConfig(path: string): Json {
  const text = readFileSync(path, "utf-8");
  return path.endsWith(".toml") ? (Bun.TOML.parse(text) as Json) : JSON.parse(text);
}

function configItems(root: string, pkg: string, file: string): string[] {
  const path = resolve(root, file);
  if (!existsSync(path)) return [];
  const { hooks: _runByHookItems, ...config } = parseConfig(path);
  return keyItems(file, config, "").map((item) => normalised(item, root, pkg));
}

function hookItems(root: string, file: string): string[] {
  const path = resolve(root, file);
  if (!existsSync(path)) return [];
  const scripts = readFileSync(path, "utf-8").matchAll(HOOK_SCRIPT);
  return [...new Set(Array.from(scripts, (m) => `${file}#hook=${m[1]}`))];
}

export function surface(root: string, pkg: string): string[] {
  const files = ROOTS.flatMap((dir) => walk(root, resolve(root, dir)))
    .filter((rel) => !NOT_SURFACE.some((pattern) => pattern.test(rel)))
    .map((rel) => fileItem(root, pkg, rel));
  return [
    ...new Set([
      ...files,
      ...CONFIGS.flatMap((file) => configItems(root, pkg, file)),
      ...HOOK_CONFIGS.flatMap((file) => hookItems(root, file)),
    ]),
  ].sort();
}

function setKey(config: Json, path: string, leaf: (current: unknown) => unknown): void {
  const keys = path.split(".");
  const last = keys.pop() as string;
  const parent = keys.reduce<Json>((node, key) => {
    if (!isPlainObject(node[key])) node[key] = {};
    return node[key] as Json;
  }, config);
  parent[last] = leaf(parent[last]);
}

function plantInConfig(path: string, spec: string): void {
  if (path.endsWith(".toml")) {
    if (spec.includes("[]=")) throw new Error(`cannot plant a TOML list entry: ${spec}`);
    writeFileSync(path, `${spec} = true\n${readFileSync(path, "utf-8")}`);
    return;
  }
  const config = existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
  const [key, entry] = spec.split("[]=");
  setKey(config, key, (current) =>
    entry === undefined ? true : [...(Array.isArray(current) ? current : []), entry]
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
}

function plantHook(path: string, script: string): void {
  const text = readFileSync(path, "utf-8");
  const first = /([\\/]src[\\/]hooks[\\/])[\w-]+\.ts/.exec(text);
  if (!first) throw new Error(`no hook to rename in ${path}`);
  writeFileSync(path, text.replace(first[0], `${first[1]}${script}`));
}

function plantLink(target: string, link: string): void {
  const toDir = existsSync(target) && statSync(target).isDirectory();
  (toDir ? linkDir : linkFile)(target, link);
}

function plantFile(root: string, pkg: string, item: string): void {
  const [rel, target] = item.split(" -> ");
  const path = resolve(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  if (target) plantLink(concrete(target, root, pkg), path);
  else writeFileSync(path, rel.endsWith(".json") ? "{}" : "left by an older PAL\n");
}

/** Recreates one item the way an older PAL left it. */
export function plant(root: string, pkg: string, item: string): void {
  const [file, spec] = concrete(item, root, pkg).split(/#(.*)/s);
  if (spec === undefined) plantFile(root, pkg, item);
  else if (spec.startsWith("hook="))
    plantHook(resolve(root, file), spec.slice("hook=".length));
  else plantInConfig(resolve(root, file), spec);
}

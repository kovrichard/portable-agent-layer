import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { type AdminHandlers, cliTree } from "../src/cli/tree";
import { type Command, runCommand } from "../src/tools/lib/command";

const handlerRan = () => {
  throw new Error("a handler ran during a help or misuse call");
};
const admin: AdminHandlers = {
  init: handlerRan,
  install: handlerRan,
  uninstall: handlerRan,
  update: handlerRan,
  export: handlerRan,
  import: handlerRan,
  status: handlerRan,
  doctor: handlerRan,
  debug: handlerRan,
  version: handlerRan,
};

function nodes(command: Command, path: string[]): [string[], Command][] {
  if (command.kind === "leaf") return [[path, command]];
  const children = Object.entries(command.commands).flatMap(([name, sub]) =>
    nodes(sub, [...path, name])
  );
  return [[path, command], ...children];
}

const TREE = nodes(cliTree(admin), ["pal", "cli"]);
const SANDBOX_KEYS = ["PAL_HOME", "PAL_CLAUDE_DIR", "PAL_CODEX_DIR", "PAL_AGENTS_DIR"];
const saved = Object.fromEntries(SANDBOX_KEYS.map((k) => [k, process.env[k]]));
let sandbox: string;
let out: string[];
let err: string[];
let spies: ReturnType<typeof spyOn>[];

beforeAll(() => {
  sandbox = mkdtempSync(resolve(tmpdir(), "pal-cli-tree-"));
  for (const key of SANDBOX_KEYS) process.env[key] = resolve(sandbox, key);
});

afterAll(() => {
  for (const key of SANDBOX_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  out = [];
  err = [];
  spies = [
    spyOn(console, "log").mockImplementation((...a) => out.push(a.join(" "))),
    spyOn(console, "error").mockImplementation((...a) => err.push(a.join(" "))),
  ];
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

const at = (path: string[]) => path.slice(2);

describe("every pal cli command", () => {
  test("the tree reaches the commands it should", () => {
    const paths = TREE.map(([path]) => path.join(" "));
    for (const expected of [
      "pal cli install",
      "pal cli rule list",
      "pal cli skill run",
      "pal cli knowledge search",
      "pal cli project add-next",
      "pal cli interaction report",
      "pal cli thread",
      "pal cli debug on",
    ])
      expect(paths).toContain(expected);
  });

  test.each(
    TREE.map(([path, command]) => [path.join(" "), path, command] as const)
  )("%s: --help and -h print its own usage, run nothing, exit 0", async (name, path, command) => {
    for (const flag of ["--help", "-h"]) {
      out = [];
      expect(await runCommand(cliTree(admin), [...at(path), flag], ["pal", "cli"])).toBe(
        0
      );
      const text = out.join("\n");
      expect(text).toStartWith(`Usage: ${name}`);
      expect(text).toContain(command.summary);
    }
    expect(err).toEqual([]);
    expect(readdirSync(sandbox)).toEqual([]);
  });

  test.each(
    TREE.map(([path]) => [path.join(" "), path] as const)
  )("%s: an unknown flag prints the error and its usage, exit 1", async (name, path) => {
    expect(
      await runCommand(
        cliTree(admin),
        [...at(path), "--definitely-bogus"],
        ["pal", "cli"]
      )
    ).toBe(1);
    expect(out).toEqual([]);
    expect(err.join("\n")).toMatch(/^error: .*--definitely-bogus/);
    expect(err.join("\n")).toContain(`Usage: ${name}`);
    expect(readdirSync(sandbox)).toEqual([]);
  });
});

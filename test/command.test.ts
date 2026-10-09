import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  type CommandInput,
  group,
  helpText,
  leaf,
  runCommand,
  UsageError,
} from "../src/tools/lib/command";

let out: string[];
let err: string[];
let logSpy: ReturnType<typeof spyOn> | undefined;
let errSpy: ReturnType<typeof spyOn> | undefined;
let calls: CommandInput[];

beforeEach(() => {
  logSpy?.mockRestore();
  errSpy?.mockRestore();
  out = [];
  err = [];
  calls = [];
  logSpy = spyOn(console, "log").mockImplementation((...a) => out.push(a.join(" ")));
  errSpy = spyOn(console, "error").mockImplementation((...a) => err.push(a.join(" ")));
});

function record(result?: number) {
  return (input: CommandInput) => {
    calls.push(input);
    return result;
  };
}

const tree = group({
  summary: "Root",
  aliases: { ls: "list" },
  commands: {
    list: leaf({
      summary: "List things",
      options: {
        limit: { type: "string", value: "<n>", description: "At most n" },
        all: { type: "boolean", short: "a", description: "Everything" },
        tag: { type: "string", multiple: true, description: "Tags" },
      },
      run: record(),
    }),
    exec: leaf({
      summary: "Run a skill's tool",
      args: "<skill> <tool>",
      passThrough: true,
      options: { dry: { type: "boolean", description: "Plan only" } },
      run: record(),
    }),
    throwsNull: leaf({
      summary: "Throws null",
      run: () => Promise.reject(null),
    }),
    add: leaf({ summary: "Add one", args: "<name> [note]", run: record(3) }),
    say: leaf({ summary: "Say words", args: "<words...>", run: record() }),
    run: leaf({
      summary: "Run a tool",
      args: "<tool>",
      passThrough: true,
      run: record(),
    }),
    check: leaf({
      summary: "Check",
      run: () => {
        throw new UsageError("not today. Try tomorrow");
      },
    }),
    crash: leaf({
      summary: "Crash",
      run: () => {
        throw new Error("boom");
      },
    }),
    nested: group({
      summary: "Nested",
      fallback: "show",
      commands: { show: leaf({ summary: "Show", run: record(7) }) },
    }),
  },
});

const PATH = ["pal", "cli", "x"];
const run = (...args: string[]) => runCommand(tree, args, PATH);

describe("help", () => {
  test.each([
    [[]],
    [["--help"]],
    [["-h"]],
    [["help"]],
  ])("a group prints its commands for %p and exits 0", async (args) => {
    expect(await run(...args)).toBe(0);
    expect(out.join("\n")).toStartWith("Usage: pal cli x <command>");
    expect(out.join("\n")).toContain("  list | ls ");
    expect(out.join("\n")).toContain("add <name> [note]");
  });

  test("a leaf prints its options, value placeholders and the help flag", async () => {
    expect(await run("list", "--limit", "3", "-h")).toBe(0);
    const text = out.join("\n");
    expect(text).toStartWith("Usage: pal cli x list [options]");
    expect(text).toContain("--limit <n>");
    expect(text).toContain("-a, --all");
    expect(text).toContain("-h, --help");
    expect(calls).toHaveLength(0);
  });

  describe("exact page layout", () => {
    const full = leaf({
      summary: "Run a tool",
      args: "<tool>",
      passThrough: true,
      details: "Details here.\n",
      options: {
        out: { type: "string", value: "<file>", description: "Where to write" },
        mode: { type: "string", description: "How" },
        quiet: { type: "boolean", short: "q", description: "Say less" },
      },
      run: () => 0,
    });
    const bare = leaf({ summary: "Bare", run: () => 0 });
    const root = group({
      summary: "Root",
      fallback: "bare",
      aliases: { b: "bare" },
      details: "More.\n",
      commands: { full, bare, sub: group({ summary: "Sub", commands: { x: bare } }) },
    });

    test.each([
      [
        full,
        ["t", "full"],
        "Usage: t full <tool> [options] [<passed-on>...]\n\n  Run a tool\n\nOptions:\n  --out <file>    Where to write\n  --mode <value>  How\n  -q, --quiet     Say less\n  -h, --help      Show this help\n\nDetails here.",
      ],
      [
        bare,
        ["t", "bare"],
        "Usage: t bare\n\n  Bare\n\nOptions:\n  -h, --help  Show this help",
      ],
      [
        root,
        ["t"],
        "Usage: t [<command>]\n\n  Root\n\nCommands:\n  full <tool>  Run a tool\n  bare | b     Bare\n  sub          Sub\n\nWith no command, runs 'bare'.\nRun 't <command> --help' for its arguments and options.\n\nMore.",
      ],
      [
        group({ summary: "Plain", commands: { bare } }),
        ["p", "q"],
        "Usage: p q <command>\n\n  Plain\n\nCommands:\n  bare  Bare\n\nRun 'p q <command> --help' for its arguments and options.",
      ],
    ])("%#", (command, path, page) => {
      expect(helpText(command, path)).toBe(page);
    });
  });

  test("help is hierarchical: a nested group has its own page", async () => {
    expect(await run("nested", "--help")).toBe(0);
    expect(out.join("\n")).toStartWith("Usage: pal cli x nested [<command>]");
    expect(out.join("\n")).toContain("With no command, runs 'show'.");
  });
});

describe("dispatch", () => {
  test("parses typed values and returns the leaf's exit code", async () => {
    expect(await run("ls", "--limit", "5", "-a")).toBe(0);
    expect(calls[0]?.values).toEqual({ limit: "5", all: true });
    expect(await run("add", "x")).toBe(3);
  });

  test("a group with a fallback runs it when given no command", async () => {
    expect(await run("nested")).toBe(7);
  });

  test("a variadic slot takes every word", async () => {
    await run("say", "a", "b", "c");
    expect(calls[0]?.positionals).toEqual(["a", "b", "c"]);
  });

  test("pass-through hands everything after the slots to the tool untouched", async () => {
    await run("run", "build", "--out", "x", "--help");
    await run("run", "build", "--", "--out", "x");
    expect(calls.map((c) => [c.positionals, c.passedThrough])).toEqual([
      [["build"], ["--out", "x", "--help"]],
      [["build"], ["--out", "x"]],
    ]);
  });

  test("pass-through counts only the slots, so the leaf's own flags may come first", async () => {
    await run("exec", "--dry", "s", "t", "--out", "x");
    expect(calls.map((c) => [c.positionals, c.values, c.passedThrough])).toEqual([
      [["s", "t"], { dry: true }, ["--out", "x"]],
    ]);
  });

  test("pass-through: '--' before the slots are filled leaves them missing", async () => {
    expect(await run("exec", "s", "--", "t")).toBe(1);
    expect(err.join("\n")).toStartWith("error: missing <tool>");
  });

  test("a leaf without pass-through passes nothing on", async () => {
    await run("say", "a", "--", "--b");
    expect(calls.map((c) => [c.positionals, c.passedThrough])).toEqual([
      [["a", "--b"], []],
    ]);
  });

  test("free text that starts with a dash is text, not a flag", async () => {
    expect(await run("say", "- a\n- b")).toBe(0);
    expect(await run("list", "--limit", "- 3 -", "--tag", "- x y", "--tag", "z")).toBe(0);
    expect(calls.map((c) => [c.positionals, c.values])).toEqual([
      [["- a\n- b"], {}],
      [[], { limit: "- 3 -", tag: ["- x y", "z"] }],
    ]);
  });

  test("an error that is not a usage error still propagates", async () => {
    await expect(run("crash")).rejects.toThrow("boom");
    await expect(run("throwsNull")).rejects.toBeNull();
  });
});

describe("misuse prints the error and that command's usage, exit 1", () => {
  test.each([
    [["nope"], "unknown command 'nope'", "Usage: pal cli x <command>"],
    [["list", "--bogus"], "Unknown option '--bogus'", "Usage: pal cli x list"],
    [["list", "extra"], "unexpected argument 'extra'", "Usage: pal cli x list"],
    [["add"], "missing <name>", "Usage: pal cli x add <name> [note]"],
    [["add", "a", "b", "c"], "unexpected argument 'c'", "Usage: pal cli x add"],
    [["say"], "missing <words...>", "Usage: pal cli x say"],
    [["check"], "not today. Try tomorrow", "Usage: pal cli x check"],
  ])("%p", async (args, message, usage) => {
    expect(await run(...args)).toBe(1);
    expect(out).toEqual([]);
    expect(err.join("\n")).toStartWith(`error: ${message}\n\n${usage}`);
  });

  test("a parse error keeps only its first sentence", async () => {
    await run("list", "--bogus");
    expect(err.join("\n")).not.toContain("To specify a positional argument");
  });
});

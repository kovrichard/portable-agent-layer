import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { run as algorithmReflect } from "../src/tools/agent/algorithm-reflect";
import { run as algorithmSynthesize } from "../src/tools/agent/algorithm-synthesize";
import { run as analyze } from "../src/tools/agent/analyze";
import { run as synthesize } from "../src/tools/agent/synthesize";
import { run as thread } from "../src/tools/agent/thread";
import { freshTestDir } from "./lib/test-home";

const TOOLS: [string, (argv: string[]) => Promise<number>][] = [
  ["algorithm-reflect", algorithmReflect],
  ["algorithm-synthesize", algorithmSynthesize],
  ["analyze", analyze],
  ["synthesize", synthesize],
  ["thread", thread],
];

let home: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
});

async function captured(
  stream: "log" | "error",
  call: () => Promise<number>
): Promise<{ code: number; text: string }> {
  const spy = spyOn(console, stream).mockImplementation(() => {});
  try {
    const code = await call();
    return { code, text: spy.mock.calls.map((c) => c.join(" ")).join("\n") };
  } finally {
    spy.mockRestore();
  }
}

describe.each(TOOLS)("pal cli %s", (name, run) => {
  test("--help prints its usage and succeeds", async () => {
    const { code, text } = await captured("log", () => run(["--help"]));
    expect(code).toBe(0);
    expect(text).toContain(`Usage: pal cli ${name}`);
  });

  test("an unknown flag is a usage error, not a crash", async () => {
    const { code, text } = await captured("error", () => run(["--definitely-bogus"]));
    expect(code).toBe(1);
    expect(text).toContain("error:");
    expect(text).toContain(`Usage: pal cli ${name}`);
  });
});

const MISUSE: [string, string[], string][] = [
  ["algorithm-reflect", ["--task", "t", "--q1", "a"], "missing --q2, --q3"],
  ["thread", [], "one of --add, --resolve, --list is required"],
  ["thread", ["--add"], "--add needs --title"],
  ["thread", ["--resolve"], "--resolve needs --id"],
  ["synthesize", ["--days", "x"], "--days must be a number"],
  ["algorithm-synthesize", ["--since", "nope"], "--since is not a date"],
];

describe("a call the tool cannot act on", () => {
  test.each(MISUSE)("%s %p is refused with its usage", async (name, argv, message) => {
    const run = new Map(TOOLS).get(name);
    if (!run) throw new Error(`no tool named ${name}`);
    const { code, text } = await captured("error", () => run(argv));
    expect(code).toBe(1);
    expect(text).toContain(`error: ${message}`);
    expect(text).toContain(`Usage: pal cli ${name}`);
  });
});

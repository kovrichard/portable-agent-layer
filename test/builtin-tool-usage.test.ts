import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { run as algorithmReflect } from "../src/tools/agent/algorithm-reflect";
import { run as algorithmSynthesize } from "../src/tools/agent/algorithm-synthesize";
import { run as analyze } from "../src/tools/agent/analyze";
import { run as handoffNote } from "../src/tools/agent/handoff-note";
import { run as relationshipNote } from "../src/tools/agent/relationship-note";
import { run as relationshipReflect } from "../src/tools/agent/relationship-reflect";
import { run as synthesize } from "../src/tools/agent/synthesize";
import { run as thread } from "../src/tools/agent/thread";
import { run as wisdomFrame } from "../src/tools/agent/wisdom-frame";
import { removeOnceReleased } from "./lib/remove-once-released";

const TOOLS: [string, (argv: string[]) => Promise<number>][] = [
  ["algorithm-reflect", algorithmReflect],
  ["algorithm-synthesize", algorithmSynthesize],
  ["analyze", analyze],
  ["handoff-note", handoffNote],
  ["relationship-note", relationshipNote],
  ["relationship-reflect", relationshipReflect],
  ["synthesize", synthesize],
  ["thread", thread],
  ["wisdom-frame", wisdomFrame],
];

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.PAL_HOME;
  home = mkdtempSync(resolve(tmpdir(), "pal-tool-usage-"));
  process.env.PAL_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = previousHome;
  removeOnceReleased(home);
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
  ["handoff-note", ["--waiting", "x"], "--title and --text are required"],
  ["thread", [], "one of --add, --resolve, --list is required"],
  ["thread", ["--add"], "--add needs --title"],
  ["thread", ["--resolve"], "--resolve needs --id"],
  ["wisdom-frame", ["-d", "workflow"], "--domain and --observation are required"],
  ["relationship-note", [], "Required: at least one of --o, --w, --b"],
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

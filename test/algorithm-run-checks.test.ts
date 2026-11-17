import { describe, expect, test } from "bun:test";
import {
  CHECK_COMMANDS,
  citedUrls,
  RESEARCH_SHARE,
  runChecks,
  runTypesOf,
  uncitedUrls,
} from "../src/progress/algorithm-run-checks";
import { type TurnTools, turnTools } from "../src/progress/algorithm-run-tools";
import {
  algorithmReply,
  assistantText,
  bash,
  edit,
  toolResult,
  toolUse,
  transcriptLines,
  userPrompt,
} from "./lib/algorithm-run-fixture";

type Entry = Record<string, unknown>;

const REFLECT = bash("pal cli algorithm-reflect --task t --q1 a --q2 b --q3 c");
const DONE = algorithmReply(["OBSERVE", "PLAN", "EXECUTE"]);

function toolsOf(entries: Entry[]): TurnTools {
  return turnTools(transcriptLines([userPrompt("go"), ...entries])) as TurnTools;
}

function checksOf(entries: Entry[], reply = DONE) {
  return runChecks([reply], toolsOf(entries));
}

function webFetch(url: string): Entry {
  return toolUse("WebFetch", { url, prompt: "summarise" });
}

function agent(subagentType: string, prompt = "look it up"): Entry {
  return toolUse("Agent", { subagent_type: subagentType, prompt });
}

describe("the turn's tool calls, read from transcript lines", () => {
  test("calls and their output after the last prompt, in order", () => {
    const lines = transcriptLines([
      userPrompt("earlier"),
      edit("old.ts"),
      userPrompt("now"),
      assistantText("looking"),
      bash("ls"),
      toolResult("a.ts"),
      toolUse("Read", { file_path: "a.ts" }),
      toolResult([{ type: "text", text: "one" }, { type: "text" }], { file: "a.ts" }),
    ]);
    expect(turnTools(lines)).toEqual({
      calls: [
        { name: "Bash", input: { command: "ls" } },
        { name: "Read", input: { file_path: "a.ts" } },
      ],
      outputs: ["a.ts", "one\n", '{"file":"a.ts"}'],
    });
  });

  test("a subagent's own entries and unparsable lines are not the turn's", () => {
    const sidechain = { ...edit(), isSidechain: true };
    const lines = [
      ...transcriptLines([userPrompt("go"), sidechain]),
      "{broken",
      "7",
      ...transcriptLines([toolUse("Grep", {}), toolUse("Glob", { input: 1 })]),
    ];
    expect(turnTools(lines)?.calls.map((c) => c.name)).toEqual(["Grep", "Glob"]);
    expect(
      turnTools(
        transcriptLines([
          { type: "assistant", message: { content: [{ type: "tool_use", input: {} }] } },
          { type: "assistant", message: { content: [{ type: "tool_use", name: "X" }] } },
          { type: "assistant", message: { content: "plain" } },
          { type: "assistant" },
        ])
      )
    ).toEqual({ calls: [{ name: "X", input: {} }], outputs: [] });
  });

  test("no Claude Code entry is no record, not a turn without tools", () => {
    expect(turnTools([])).toBeNull();
    expect(
      turnTools(transcriptLines([{ type: "response_item", payload: {} }]))
    ).toBeNull();
    expect(turnTools(transcriptLines([userPrompt("go")]))).toEqual({
      calls: [],
      outputs: [],
    });
  });
});

describe("the run type, from the tool mix", () => {
  const types = (entries: Entry[]) => runTypesOf(toolsOf(entries).calls);

  test("a file edit or a commit is code", () => {
    expect(types([edit()])).toEqual(["code"]);
    expect(types([toolUse("Write", {})])).toEqual(["code"]);
    expect(types([toolUse("NotebookEdit", {})])).toEqual(["code"]);
    expect(types([toolUse("MultiEdit", {})])).toEqual(["code"]);
    expect(types([bash('git commit -m "feat: x"')])).toEqual(["code"]);
    expect(types([bash("git -C ../repo commit -m x")])).toEqual(["code"]);
  });

  test("reads only, or nothing, is explain", () => {
    expect(types([toolUse("Read", {}), bash("git log")])).toEqual(["explain"]);
    expect(types([])).toEqual(["explain"]);
  });

  test("research when web calls are more than half of the substantive calls", () => {
    expect(RESEARCH_SHARE).toBe(0.5);
    expect(types([toolUse("WebSearch", {}), toolUse("Read", {})])).toEqual(["explain"]);
    expect(
      types([
        toolUse("WebSearch", {}),
        webFetch("https://a.example"),
        toolUse("Read", {}),
      ])
    ).toEqual(["research"]);
  });

  test("a web-fetch or researcher subagent is a web call, another subagent is not", () => {
    expect(types([agent("web-fetch")])).toEqual(["research"]);
    expect(types([agent("perplexity-researcher")])).toEqual(["research"]);
    expect(types([toolUse("Task", { subagent_type: "gemini-researcher" })])).toEqual([
      "research",
    ]);
    expect(types([agent("Explore")])).toEqual(["explain"]);
    expect(types([toolUse("Agent", {})])).toEqual(["explain"]);
    expect(types([toolUse("Read", { subagent_type: "web-fetch" })])).toEqual(["explain"]);
  });

  test("bookkeeping calls do not dilute the web share", () => {
    expect(
      types([
        toolUse("WebSearch", {}),
        toolUse("TodoWrite", {}),
        toolUse("ToolSearch", {}),
        toolUse("Skill", {}),
        toolUse("TaskCreate", {}),
        toolUse("TaskUpdate", {}),
        toolUse("TaskList", {}),
        toolUse("TaskGet", {}),
        bash("pal cli progress open x"),
        REFLECT,
      ])
    ).toEqual(["research"]);
    expect(types([toolUse("WebSearch", {}), bash("pal cli infer x")])).toEqual([
      "explain",
    ]);
  });

  test("a turn that edits and mostly fetches is both", () => {
    expect(
      types([webFetch("https://a.example"), webFetch("https://b.example"), edit()])
    ).toEqual(["code", "research"]);
  });
});

describe("no-reflection", () => {
  test("a code turn without algorithm-reflect would be nudged, one with it would not", () => {
    expect(checksOf([edit(), bash("bun test")]).wouldNudge).toEqual(["no-reflection"]);
    expect(checksOf([edit(), bash("bun test"), REFLECT]).wouldNudge).toEqual([]);
  });

  test("a research turn that fetched is past EXECUTE", () => {
    expect(checksOf([toolUse("WebSearch", {})]).wouldNudge).toEqual(["no-reflection"]);
  });

  test("an explain turn counts as past EXECUTE only by its markers", () => {
    const reads = [toolUse("Read", {})];
    expect(checksOf(reads, algorithmReply([])).wouldNudge).toEqual([]);
    expect(checksOf(reads, algorithmReply(["VERIFY"])).wouldNudge).toEqual([
      "no-reflection",
    ]);
    expect(checksOf(reads).wouldNudge).toEqual(["no-reflection"]);
  });
});

describe("no-check-after-edit", () => {
  const nudges = (entries: Entry[]) => checksOf([...entries, REFLECT]).wouldNudge;

  test("every built-in check command counts after the last edit", () => {
    for (const command of CHECK_COMMANDS)
      expect(nudges([edit(), bash(`cd repo && ${command} --x`)])).toEqual([]);
    expect(nudges([edit(), bash("bunx tsc --noEmit")])).toEqual([]);
    expect(nudges([edit(), bash("(bun run gates)")])).toEqual([]);
  });

  test("the list is the documented one", () => {
    expect([...CHECK_COMMANDS]).toEqual([
      "bun test",
      "bun run test",
      "bun run gates",
      "bun run type-check",
      "bun run check",
      "tsc",
      "npm test",
      "pytest",
      "cargo test",
      "go test",
    ]);
  });

  test("a check before the last edit does not check it", () => {
    expect(nudges([edit(), bash("bun test"), edit()])).toEqual(["no-check-after-edit"]);
  });

  test("a commit, or a command that only resembles a check, is not a check", () => {
    expect(nudges([edit(), bash("git commit -m x")])).toEqual(["no-check-after-edit"]);
    expect(nudges([edit(), bash("bun run check-write")])).toEqual([
      "no-check-after-edit",
    ]);
    expect(nudges([edit(), bash("echo pytesting")])).toEqual(["no-check-after-edit"]);
    expect(nudges([edit(), toolUse("Read", { command: "bun test" })])).toEqual([
      "no-check-after-edit",
    ]);
  });

  test("a turn that only committed is checked by any check in it", () => {
    expect(nudges([bash("bun test"), bash("git commit -m x")])).toEqual([]);
    expect(nudges([bash("git commit -m x")])).toEqual(["no-check-after-edit"]);
  });

  test("a check through PowerShell counts", () => {
    expect(nudges([edit(), toolUse("PowerShell", { command: "bun test" })])).toEqual([]);
  });
});

describe("uncited-fetch", () => {
  const research = (entries: Entry[], reply: string) =>
    checksOf([...entries, REFLECT], `${DONE}\n\n${reply}`).wouldNudge;

  test("a URL a fetch or search returned is cited", () => {
    expect(
      research(
        [webFetch("https://a.example/page"), toolResult("see https://b.example/x")],
        "From https://a.example/page and https://b.example/x."
      )
    ).toEqual([]);
  });

  test("a URL in a subagent's prompt or its returned report is cited", () => {
    expect(
      research(
        [
          agent("web-fetch", "read https://c.example/doc"),
          toolResult("https://d.example"),
        ],
        "See [doc](https://c.example/doc) and <https://d.example>."
      )
    ).toEqual([]);
  });

  test("a URL nothing in the turn returned is uncited", () => {
    expect(
      research([webFetch("https://a.example/page")], "Per https://made-up.example/x.")
    ).toEqual(["uncited-fetch"]);
  });

  test("only research turns are checked", () => {
    const nudges = checksOf(
      [edit(), bash("bun test"), REFLECT],
      "See https://x.example"
    ).wouldNudge;
    expect(nudges).toEqual([]);
  });

  test("cited URLs lose markdown and trailing punctuation", () => {
    expect(
      citedUrls(
        "[a](https://a.example/p), https://b.example/q. (https://c.example/r)! https://d.example/ https://a.example/p"
      )
    ).toEqual([
      "https://a.example/p",
      "https://b.example/q",
      "https://c.example/r",
      "https://d.example",
    ]);
    expect(citedUrls("no links")).toEqual([]);
  });

  test("the uncited URLs are named", () => {
    expect(
      uncitedUrls("https://a.example and https://b.example", {
        calls: [{ name: "WebFetch", input: { url: "https://a.example/" } }],
        outputs: [],
      })
    ).toEqual(["https://b.example"]);
  });
});

describe("exemptions get no verdict", () => {
  test("no tool record", () => {
    expect(runChecks([DONE], null)).toEqual({
      runType: [],
      wouldNudge: [],
      exempt: "no-tool-record",
    });
  });

  test("a turn that stopped at PLAN without edits", () => {
    expect(
      checksOf([toolUse("WebSearch", {})], algorithmReply(["OBSERVE", "PLAN"]))
    ).toEqual({ runType: ["research"], wouldNudge: [], exempt: "stopped-at-plan" });
    expect(checksOf([], algorithmReply(["OBSERVE"])).exempt).toBe("stopped-at-plan");
  });

  test("a PLAN turn that edited, or one with no markers, is not exempt", () => {
    expect(checksOf([edit()], algorithmReply(["PLAN"]))).toEqual({
      runType: ["code"],
      wouldNudge: ["no-reflection", "no-check-after-edit"],
      exempt: null,
    });
    expect(
      checksOf([bash("git commit -m x")], algorithmReply(["PLAN"])).exempt
    ).toBeNull();
    expect(checksOf([edit()], algorithmReply([])).exempt).toBeNull();
  });

  test("a reply that asks the user something", () => {
    expect(checksOf([edit()], `${DONE}\n\nShall I commit?  `)).toEqual({
      runType: ["code"],
      wouldNudge: [],
      exempt: "asked-user",
    });
  });

  test("only the final text decides the question, and an empty turn has none", () => {
    expect(runChecks(["Shall I?", DONE], toolsOf([edit()])).exempt).toBeNull();
    expect(runChecks([], toolsOf([])).exempt).toBeNull();
  });
});

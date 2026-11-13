import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync } from "node:fs";
import * as clack from "@clack/prompts";
import { cmdAdd, parseAddFlags } from "../src/cli/knowledge-add";
import { load, RELATION_TYPES, STATUSES } from "../src/tools/knowledge/lib";
import { UsageError } from "../src/tools/lib/command";
import { captureConsole } from "./lib/console-capture";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const HOME = testHome(import.meta.file);
const CANCELLED = Symbol("cancelled");
const originalIsTTY = process.stdin.isTTY;

function setTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

function promptSpies(answers: { text: unknown[]; select: unknown }) {
  return {
    intro: spyOn(clack, "intro").mockImplementation(() => {}),
    outro: spyOn(clack, "outro").mockImplementation(() => {}),
    cancel: spyOn(clack, "cancel").mockImplementation(() => {}),
    isCancel: spyOn(clack, "isCancel").mockImplementation(
      ((v: unknown) => v === CANCELLED) as never
    ),
    text: spyOn(clack, "text").mockImplementation(
      async () => answers.text.shift() as never
    ),
    select: spyOn(clack, "select").mockImplementation(
      async () => answers.select as never
    ),
  };
}

type PromptName = keyof ReturnType<typeof promptSpies>;

async function answering(
  answers: { text: unknown[]; select: unknown },
  work: () => Promise<number>
): Promise<{ result: number; log: string[]; calls: Record<PromptName, unknown[][]> }> {
  const spies = promptSpies(answers);
  const output = captureConsole();

  try {
    const result = await work();
    const calls = Object.fromEntries(
      Object.entries(spies).map(([name, spy]) => [
        name,
        [...spy.mock.calls] as unknown[][],
      ])
    ) as Record<PromptName, unknown[][]>;

    return { result, log: output.log, calls };
  } finally {
    output.restore();

    for (const spy of Object.values(spies)) spy.mockRestore();
  }
}

function usageMessage(work: () => unknown): string {
  try {
    work();
  } catch (err) {
    expect(err).toBeInstanceOf(UsageError);

    return (err as Error).message;
  }

  throw new Error("expected a usage error");
}

beforeEach(() => {
  setTTY(originalIsTTY);
  process.env.PAL_HOME = HOME;
  removeOnceReleased(HOME);
  mkdirSync(HOME, { recursive: true });
});

describe("parseAddFlags", () => {
  test("gives empty lists and leaves the rest unset when no flag is given", () => {
    expect(parseAddFlags({})).toEqual({
      tags: [],
      related: [],
      quality: undefined,
      status: undefined,
      type: undefined,
      body: undefined,
    });
  });

  test("trims tags, drops empty ones, and reads every other flag", () => {
    expect(
      parseAddFlags({
        tags: " a , ,b ",
        related: ["x:supports"],
        quality: "0",
        status: "budding",
        type: "tool",
        body: "text",
      })
    ).toEqual({
      tags: ["a", "b"],
      related: [{ slug: "x", type: "supports" }],
      quality: 0,
      status: "budding",
      type: "tool",
      body: "text",
    });
    expect(parseAddFlags({ quality: "10" }).quality).toBe(10);
  });

  test.each(["x", ":supports"])("refuses --related %p without both halves", (value) => {
    expect(usageMessage(() => parseAddFlags({ related: [value] }))).toBe(
      `--related must be slug:type, got "${value}"`
    );
  });

  test("refuses a --related type that is not a relation", () => {
    expect(usageMessage(() => parseAddFlags({ related: ["x:knows"] }))).toBe(
      `--related type must be one of: ${RELATION_TYPES.join(", ")} (got "knows")`
    );
  });

  test.each(["-1", "11", "2.5", "many"])("refuses --quality %p", (quality) => {
    expect(usageMessage(() => parseAddFlags({ quality }))).toBe(
      "--quality must be an integer 0-10"
    );
  });

  test("refuses a --status outside the list", () => {
    expect(usageMessage(() => parseAddFlags({ status: "wilted" }))).toBe(
      `--status must be one of: ${STATUSES.join(", ")}`
    );
  });
});

describe("cmdAdd", () => {
  const flags = { tags: ["keep"], related: [], status: "budding" as const, quality: 3 };

  test.each([
    [true, true],
    [true, false],
    [false, false],
  ])("with flags given %p in a terminal %p it asks nothing", async (given, tty) => {
    setTTY(tty);
    const { result, log, calls } = await answering(
      { text: [], select: "evergreen" },
      () => cmdAdd("People", "Flag Person", flags, given)
    );

    expect(result).toBe(0);
    expect(calls.text).toEqual([]);
    expect(log).toEqual(['✓ People/flag-person — "Flag Person"']);
    expect(load("People", "flag-person")?.frontmatter).toMatchObject({
      tags: ["keep"],
      status: "budding",
      quality: 3,
    });
  });

  test("asks for tags, status and quality in a terminal when no flag is given", async () => {
    setTTY(true);
    const { result, calls } = await answering(
      { text: [" x, ,y ", "7"], select: "evergreen" },
      () => cmdAdd("People", "Asked Person", { tags: [], related: [] }, false)
    );

    expect(result).toBe(0);
    expect(calls.intro).toEqual([["Add knowledge entry"]]);
    expect(calls.text).toEqual([
      [{ message: "Tags (comma-separated, optional):", placeholder: "ai, research" }],
      [{ message: "Quality (0-10):", placeholder: "5", initialValue: "5" }],
    ]);
    expect(calls.select).toEqual([
      [
        {
          message: "Status:",
          options: STATUSES.map((s) => ({ value: s, label: s })),
          initialValue: "seedling",
        },
      ],
    ]);
    expect(calls.outro).toEqual([["Saved"]]);
    expect(load("People", "asked-person")?.frontmatter).toMatchObject({
      tags: ["x", "y"],
      status: "evergreen",
      quality: 7,
    });
  });

  test("starts the prompts from what was prefilled and keeps prefilled tags", async () => {
    setTTY(true);
    const { calls } = await answering({ text: [undefined, "4"], select: "budding" }, () =>
      cmdAdd("People", "Prefilled Person", flags, false)
    );

    expect(calls.select[0][0]).toMatchObject({ initialValue: "budding" });
    expect(calls.text[1][0]).toMatchObject({ initialValue: "3" });
    expect(load("People", "prefilled-person")?.frontmatter.tags).toEqual(["keep"]);
  });

  test("an empty tags answer adds no tags", async () => {
    setTTY(true);
    await answering({ text: [undefined, "4"], select: "budding" }, () =>
      cmdAdd("People", "Untagged Person", { tags: [], related: [] }, false)
    );

    expect(load("People", "untagged-person")?.frontmatter.tags).toEqual([]);
  });

  test.each([
    [[CANCELLED], "evergreen"],
    [["x"], CANCELLED],
    [["x", CANCELLED], "evergreen"],
  ])("a cancel at any prompt saves nothing (%#)", async (text, select) => {
    setTTY(true);
    const { result, log, calls } = await answering({ text: [...text], select }, () =>
      cmdAdd("People", "Cancelled Person", { tags: [], related: [] }, false)
    );

    expect(result).toBe(1);
    expect(calls.cancel).toEqual([["Cancelled"]]);
    expect(calls.outro).toEqual([]);
    expect(log).toEqual([]);
    expect(load("People", "cancelled-person")).toBeNull();
  });
});

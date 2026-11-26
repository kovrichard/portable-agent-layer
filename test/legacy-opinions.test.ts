import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { legacyOpinionsFindings, stateFindings } from "../src/cli/doctor/state";
import {
  markLegacyOpinionsReviewed,
  readLegacyOpinions,
} from "../src/cli/legacy-opinions";
import { runRule } from "../src/cli/rule";
import { captureConsole } from "./lib/console-capture";
import { freshTestDir } from "./lib/test-home";

const STORE = {
  lastReflect: "2026-01-01",
  opinions: [
    {
      id: "a",
      statement: "Prefers short answers",
      confidence: 0.6,
      category: "communication",
    },
    {
      id: "b",
      statement: "Runs tests before commits",
      confidence: 0.92,
      category: "workflow",
    },
    { id: "c", statement: "Likes typed code", confidence: 0.857, category: "technical" },
  ],
};

const ADVICE = [
  "Write the ones worth keeping with `pal cli rule add-opinion --kind K --when W --steering S`, then run `pal cli rule legacy-opinions --reviewed`.",
  "The new store holds at most 8 opinions, 1500 characters together, and one opinion per correction kind.",
];

const STILL_LOADING =
  "the ones still loading from the old context file stop loading when the first new opinion is approved";

async function inHome<T>(run: (relationship: string) => T | Promise<T>): Promise<T> {
  const previous = process.env.PAL_HOME;
  const home = freshTestDir(import.meta.file);
  const relationship = resolve(home, "memory", "relationship");
  mkdirSync(relationship, { recursive: true });
  process.env.PAL_HOME = home;

  try {
    return await run(relationship);
  } finally {
    if (previous === undefined) delete process.env.PAL_HOME;
    else process.env.PAL_HOME = previous;
  }
}

function writeLegacy(relationship: string, content: unknown): string {
  const path = resolve(relationship, "opinions.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));

  return path;
}

async function rule(args: string[]) {
  const output = captureConsole();

  try {
    const code = await runRule(args);

    return { code, log: output.log.join("\n").split("\n"), error: output.error };
  } finally {
    output.restore();
  }
}

const legacyFinding = () => stateFindings().find((f) => f.id === "legacy-opinions");

describe("pal cli rule legacy-opinions", () => {
  test("lists each opinion with confidence and category, highest first, then what to do", () =>
    inHome(async (relationship) => {
      writeLegacy(relationship, STORE);
      const { code, log, error } = await rule(["legacy-opinions"]);

      expect(code).toBe(0);
      expect(error).toEqual([]);
      expect(log).toEqual([
        "3 opinions from the old opinion tracker, no longer in use, highest confidence first:",
        "92%  [workflow]  Runs tests before commits",
        "86%  [technical]  Likes typed code",
        "60%  [communication]  Prefers short answers",
        "",
        ...ADVICE,
      ]);
    }));

  test("reads the plain-array format and names a lone opinion in the singular", () =>
    inHome(async (relationship) => {
      writeLegacy(relationship, [{ statement: "Wants diffs", confidence: 0.9 }]);
      const { code, log } = await rule(["legacy-opinions"]);

      expect(code).toBe(0);
      expect(log.slice(0, 2)).toEqual([
        "1 opinion from the old opinion tracker, no longer in use, highest confidence first:",
        "90%  [general]  Wants diffs",
      ]);
    }));

  test("says so and exits 0 without the file", () =>
    inHome(async () => {
      const { code, log } = await rule(["legacy-opinions"]);

      expect(code).toBe(0);
      expect(log).toEqual(["No opinions left from the old opinion tracker."]);
    }));

  test("says so and exits 0 when the file holds no opinions", () =>
    inHome(async (relationship) => {
      writeLegacy(relationship, { lastReflect: "", opinions: [] });
      const { code, log } = await rule(["legacy-opinions"]);

      expect(code).toBe(0);
      expect(log).toEqual(["No opinions left from the old opinion tracker."]);
    }));

  test.each([
    ["not JSON", "{ broken", "JSON Parse error"],
    ["null", "null", "it holds no opinions list"],
    ["no opinions list", { lastReflect: "" }, "it holds no opinions list"],
    [
      "an opinion without confidence",
      { opinions: [{ statement: "x" }] },
      "an opinion has no statement or confidence",
    ],
    [
      "an opinion without statement",
      [{ confidence: 0.9 }],
      "an opinion has no statement or confidence",
    ],
  ])(
    "a malformed file (%s) is reported as unreadable, exit 1",
    (_label, content, reason) =>
      inHome(async (relationship) => {
        const path = writeLegacy(relationship, content);
        const { code, log, error } = await rule(["legacy-opinions"]);

        expect(code).toBe(1);
        expect(log).toEqual([""]);
        expect(error).toHaveLength(1);
        expect(error[0].startsWith(`Cannot read ${path}: `)).toBe(true);
        expect(error[0]).toContain(reason);
      })
  );
});

describe("pal cli rule legacy-opinions --reviewed", () => {
  test("renames the file, is repeatable, and the doctor finding goes away", () =>
    inHome(async (relationship) => {
      const path = writeLegacy(relationship, STORE);
      const reviewed = resolve(relationship, "opinions.reviewed.json");
      expect(legacyFinding()?.severity).toBe("warn");

      const first = await rule(["legacy-opinions", "--reviewed"]);
      expect(first.code).toBe(0);
      expect(first.log).toEqual([`Renamed ${path} to opinions.reviewed.json.`]);
      expect(existsSync(path)).toBe(false);
      expect(JSON.parse(readFileSync(reviewed, "utf-8"))).toEqual(STORE);
      expect(legacyFinding()).toBeUndefined();

      const second = await rule(["legacy-opinions", "--reviewed"]);
      expect(second.code).toBe(0);
      expect(second.log).toEqual(["No opinions.json to mark reviewed."]);
      expect(JSON.parse(readFileSync(reviewed, "utf-8"))).toEqual(STORE);
    }));

  test("never overwrites an earlier reviewed file", () =>
    inHome(async (relationship) => {
      const path = writeLegacy(relationship, STORE);
      const reviewed = resolve(relationship, "opinions.reviewed.json");
      writeFileSync(reviewed, "earlier");
      const { code, log, error } = await rule(["legacy-opinions", "--reviewed"]);

      expect(code).toBe(1);
      expect(log).toEqual([""]);
      expect(error).toEqual([
        `${reviewed} already exists; move it away, then run this again.`,
      ]);
      expect(readFileSync(reviewed, "utf-8")).toBe("earlier");
      expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(STORE);
    }));
});

describe("the doctor's legacy opinions finding", () => {
  const fix = {
    say: "Review them and re-add the ones worth keeping",
    command: "pal cli rule legacy-opinions",
    external: false,
  };

  test("warns with the count while opinions.json holds opinions", () =>
    inHome((relationship) => {
      writeLegacy(relationship, STORE);

      expect(legacyFinding()).toEqual({
        id: "legacy-opinions",
        severity: "warn",
        title: `3 opinions from the old opinion tracker are no longer in use — ${STILL_LOADING}`,
        fix,
      });
    }));

  test("names a lone opinion in the singular", () => {
    const opinion = { statement: "x", confidence: 0.5, category: "general" };

    expect(legacyOpinionsFindings({ state: "read", opinions: [opinion] })[0].title).toBe(
      `1 opinion from the old opinion tracker is no longer in use — ${STILL_LOADING}`
    );
  });

  test("says when the file cannot be read", () =>
    inHome((relationship) => {
      writeLegacy(relationship, "null");

      expect(legacyFinding()).toEqual({
        id: "legacy-opinions",
        severity: "warn",
        title:
          "The old opinion tracker's opinions.json cannot be read — it holds no opinions list",
        fix,
      });
    }));

  test("is absent without the file or with no opinions in it", () =>
    inHome((relationship) => {
      expect(legacyFinding()).toBeUndefined();
      writeLegacy(relationship, []);
      expect(legacyFinding()).toBeUndefined();
      expect(legacyOpinionsFindings({ state: "missing" })).toEqual([]);
      expect(legacyOpinionsFindings({ state: "read", opinions: [] })).toEqual([]);
    }));
});

describe("the legacy opinions store", () => {
  test("reads opinions sorted by confidence, and reports each rename outcome", () =>
    inHome((relationship) => {
      writeLegacy(relationship, [{ statement: "Wants diffs", confidence: 0.9 }]);

      expect(readLegacyOpinions()).toEqual({
        state: "read",
        opinions: [{ statement: "Wants diffs", confidence: 0.9, category: "general" }],
      });
      expect(markLegacyOpinionsReviewed()).toBe("renamed");
      expect(markLegacyOpinionsReviewed()).toBe("missing");
      expect(readLegacyOpinions()).toEqual({ state: "missing" });
    }));

  test("the command's help says what it shows and what --reviewed does", async () => {
    const { code, log } = await rule(["legacy-opinions", "--help"]);

    expect(code).toBe(0);
    expect(log).toContain(
      "  Show the opinions the old opinion tracker left, to re-add the ones to keep"
    );
    expect(log).toContain(
      "  --reviewed  Mark them reviewed: renames opinions.json to opinions.reviewed.json"
    );
  });
});

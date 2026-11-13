import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { runKnowledge } from "../src/cli/knowledge";
import {
  type ExtractedEntity,
  queueForReview,
  type ResearchProfile,
  type ReviewItem,
} from "../src/hooks/lib/entity-extraction";
import { pendingReviews } from "../src/hooks/lib/entity-review";
import { ingestEntities } from "../src/tools/knowledge/ingest";
import { captureConsole } from "./lib/console-capture";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const HOME = testHome(import.meta.file);
const INDENT = " ".repeat(12);
let output: ReturnType<typeof captureConsole>;

const PROFILE: ResearchProfile = {
  match: "sure",
  summary: "Makes widgets",
  role: "",
  organization: "",
  website: "https://kappa.example",
  linkedin: "",
  socials: [],
  registry: {
    name: "",
    number: "",
    taxNumber: "",
    seat: "",
    status: "",
    activity: "",
    managers: [],
    url: "",
  },
  news: [],
  sources: [],
};

function item(id: string, over: Partial<ReviewItem>, entity: Partial<ExtractedEntity>) {
  return {
    ts: "2026-06-01T12:00:00.000Z",
    source: `chat ${id}`,
    id,
    reason: "ambiguous" as const,
    candidates: [],
    ...over,
    entity: {
      kind: "person" as const,
      name: `Name ${id}`,
      existing: "",
      aliases: [],
      role: "",
      organization: "",
      relation: "",
      fact: "",
      ...entity,
    },
  };
}

async function run(...args: string[]): Promise<number> {
  const captured = captureConsole();

  try {
    return await runKnowledge(["review", ...args]);
  } finally {
    captured.restore();
    output = captured;
  }
}

beforeEach(() => {
  process.env.PAL_HOME = HOME;
  removeOnceReleased(HOME);
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  ingestEntities({ companies: [{ name: "Kappa Ltd" }] }, "seed");
});

describe("pal cli knowledge review help", () => {
  test("describes each command and the options of accept", async () => {
    await run("--help");
    const groupHelp = output.log.join("\n");
    await run("accept", "--help");
    const acceptHelp = output.log.join("\n");

    expect(groupHelp).toContain(
      "People and companies the background extractor would not guess"
    );
    expect(groupHelp).toMatch(/list\s+Show what waits for an answer/);
    expect(groupHelp).toMatch(
      /accept <id>\s+Write an item, to an existing entry \(--as\) or a new one/
    );
    expect(groupHelp).toMatch(/reject <id>\s+Drop an item without writing it/);
    expect(acceptHelp).toMatch(/--as <slug>\s+Existing entry to update/);
    expect(acceptHelp).toMatch(
      /--name <name>\s+Name for a new entry \(default: as extracted\)/
    );
  });
});

describe("pal cli knowledge review list", () => {
  test("shows each item with its reason and details, then how to answer", async () => {
    queueForReview([
      item("a1", { candidates: ["one", "two"] }, { fact: "Leads the team" }),
      item("b2", { reason: "unknown-existing" }, {}),
      item("c3", { reason: "first-name-only" }, { fact: "Plays chess" }),
      item(
        "d4",
        { reason: "web-profile", profile: PROFILE },
        { kind: "company", existing: "kappa-ltd" }
      ),
      item("e5", { reason: "web-profile", profile: PROFILE }, {}),
    ]);

    expect(await run("list")).toBe(0);
    expect(output.log).toEqual([
      "\n5 waiting for review\n",
      [
        '  a1  person "Name a1" — could be more than one known entry',
        `${INDENT}Leads the team`,
        `${INDENT}could be: one, two`,
        `${INDENT}from chat a1`,
      ].join("\n"),
      [
        '  b2  person "Name b2" — named an entry the store does not have',
        `${INDENT}from chat b2`,
      ].join("\n"),
      [
        '  c3  person "Name c3" — first name only',
        `${INDENT}Plays chess`,
        `${INDENT}from chat c3`,
      ].join("\n"),
      [
        '  d4  company "Name d4" — found on the web',
        `${INDENT}for kappa-ltd`,
        `${INDENT}Makes widgets`,
        `${INDENT}**Links**`,
        `${INDENT}- Website: https://kappa.example`,
      ].join("\n"),
      [
        '  e5  person "Name e5" — found on the web',
        `${INDENT}as a new entry`,
        `${INDENT}Makes widgets`,
        `${INDENT}**Links**`,
        `${INDENT}- Website: https://kappa.example`,
      ].join("\n"),
      "\nAccept: pal cli knowledge review accept <id> [--as <slug>] [--name <name>]\nReject: pal cli knowledge review reject <id>\n",
    ]);
  });
});

describe("pal cli knowledge review accept and reject", () => {
  test("accepting creates a new entry or updates the named one", async () => {
    queueForReview([
      item("a1", {}, { fact: "New here" }),
      item("b2", {}, { kind: "company", fact: "Hiring" }),
    ]);

    expect(await run("accept", "a1")).toBe(0);
    expect(output.log).toEqual(['Created name-a1 from "Name a1".']);
    expect(await run("accept", "b2", "--as", "kappa-ltd")).toBe(0);
    expect(output.log).toEqual(['Updated kappa-ltd from "Name b2".']);
  });

  test("an entry that does not exist is a usage error and the item stays", async () => {
    queueForReview([item("a1", {}, {})]);

    expect(await run("accept", "a1", "--as", "nobody")).toBe(1);
    expect(output.error[0]).toStartWith('error: no People entry with slug "nobody"\n');
    expect(pendingReviews()).toHaveLength(1);
  });

  test.each(["accept", "reject"])(
    "%s of an unknown id is a usage error",
    async (verb) => {
      expect(await run(verb, "zz9")).toBe(1);
      expect(output.error[0]).toStartWith('error: no review item "zz9"\n');
    }
  );

  test("rejecting drops the item without writing it", async () => {
    queueForReview([item("a1", {}, {})]);

    expect(await run("reject", "a1")).toBe(0);
    expect(output.log).toEqual(['Dropped "Name a1".']);
    expect(pendingReviews()).toEqual([]);
  });
});

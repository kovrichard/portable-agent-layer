import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractSessionEntities } from "../src/hooks/handlers/entity-extraction";
import { loadKnownEntities, loadNameIndex } from "../src/hooks/lib/entity-cards";
import {
  type ExtractedEntity,
  extractionSchema,
  planExtraction,
  queueForReview,
  reviewQueueFile,
  seenCount,
  unseenUserText,
  worthExtracting,
} from "../src/hooks/lib/entity-extraction";
import {
  buildNameIndex,
  type NamedEntity,
  type NameIndex,
} from "../src/hooks/lib/entity-names";
import { reload } from "../src/hooks/lib/settings";
import { ingestEntities } from "../src/tools/knowledge/ingest";
import { load } from "../src/tools/knowledge/lib";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const HOME = testHome(import.meta.file);
const EXCLUDED = ["Quill", "Jarvis"];

const KNOWN: NamedEntity[] = [
  { slug: "pip-lanter", domain: "People", title: "Pip Lanter", aliases: ["pipster"] },
  { slug: "zsofia-berek", domain: "People", title: "Zsófia Berek", aliases: [] },
  { slug: "tovar-zsofia", domain: "People", title: "Tóvár Zsófia", aliases: [] },
  {
    slug: "quill-ostrander",
    domain: "People",
    title: "Quill Ostrander",
    aliases: ["Quill"],
  },
  {
    slug: "brightmoor-io",
    domain: "Companies",
    title: "Brightmoor Kft.",
    aliases: [],
    domainName: "brightmoor.io",
  },
  {
    slug: "fenwick-kft",
    domain: "Companies",
    title: "Fenwick Kft.",
    aliases: [],
    domainName: "fenwick.hu",
  },
];
let index: NameIndex;

function extracted(over: Partial<ExtractedEntity>): ExtractedEntity {
  return {
    kind: "person",
    name: "",
    existing: "",
    aliases: [],
    role: "",
    organization: "",
    relation: "",
    fact: "",
    ...over,
  };
}

function plan(items: ExtractedEntity[]) {
  return planExtraction(items, index, EXCLUDED, "chat test");
}

beforeEach(() => {
  process.env.PAL_HOME = HOME;
  removeOnceReleased(HOME);
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  reload();
  index = buildNameIndex(KNOWN, EXCLUDED);
});

describe("extractionSchema", () => {
  test("asks for a closed list of entities with every field required", () => {
    const schema = extractionSchema();
    const entity = schema.properties.entities.items;
    const fields = Object.keys(extracted({})).sort();
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["entities"],
      properties: { entities: { type: "array" } },
    });
    expect(entity.type).toBe("object");
    expect(entity.additionalProperties).toBe(false);
    expect(Object.keys(entity.properties).sort()).toEqual(fields);
    expect([...entity.required].sort()).toEqual(fields);
  });

  test("types each field the way parseExtraction reads it", () => {
    const { properties } = extractionSchema().properties.entities.items;
    expect(properties.kind).toEqual({ type: "string", enum: ["person", "company"] });
    expect(properties.aliases).toEqual({ type: "array", items: { type: "string" } });
    for (const field of ["name", "existing", "role", "organization", "relation", "fact"])
      expect(properties[field as keyof typeof properties]).toEqual({ type: "string" });
  });
});

describe("planExtraction", () => {
  test("a new person with a full name is written", () => {
    const p = plan([
      extracted({ name: "Odo Vance", relation: "client", fact: "Pays late." }),
    ]);
    expect(p.ingest.people).toEqual([
      expect.objectContaining({
        name: "Odo Vance",
        relation: "client",
        context: "Pays late.",
      }),
    ]);
    expect(p.review).toEqual([]);
  });

  test("a known person named by its slug is updated under its stored name, with the new alias", () => {
    const p = plan([
      extracted({ name: "Pippy", existing: "pip-lanter", fact: "Moved to Graz." }),
    ]);
    expect(p.ingest.people).toEqual([
      expect.objectContaining({ name: "Pip Lanter", aliases: ["Pippy"] }),
    ]);
  });

  test("a full name that matches one known person updates it without a slug", () => {
    const p = plan([extracted({ name: "Zsofia Berek" })]);
    expect(p.ingest.people?.[0]?.name).toBe("Zsófia Berek");
  });

  test("a given name shared by two known people goes to review", () => {
    const p = plan([extracted({ name: "Zsófia" })]);
    expect(p.ingest.people).toEqual([]);
    expect(p.review[0]).toMatchObject({
      reason: "ambiguous",
      candidates: ["tovar-zsofia", "zsofia-berek"],
    });
  });

  test("an unknown first name alone goes to review instead of creating a person", () => {
    expect(plan([extracted({ name: "Dax" })]).review[0]?.reason).toBe("first-name-only");
  });

  test("a slug the store does not have goes to review", () => {
    expect(plan([extracted({ name: "Odo", existing: "odo-x" })]).review[0]?.reason).toBe(
      "unknown-existing"
    );
  });

  test("the user and the assistant are never written", () => {
    const p = plan([
      extracted({ name: "Quill" }),
      extracted({ name: "Jarvis Bot", aliases: ["Jarvis"] }),
    ]);
    expect(p.ingest.people).toEqual([]);
    expect(p.review).toEqual([]);
  });

  test("a known company is updated in its own file under its stored name", () => {
    const p = plan([
      extracted({ kind: "company", name: "Brightmoor", existing: "brightmoor-io" }),
    ]);
    expect(p.ingest.companies).toEqual([
      expect.objectContaining({
        name: "Brightmoor Kft.",
        slug: "brightmoor-io",
        aliases: ["Brightmoor"],
      }),
    ]);
  });

  test("a known company filed under its title is updated there, not under its domain", () => {
    const p = plan([
      extracted({ kind: "company", name: "Fenwick", existing: "fenwick-kft" }),
    ]);
    expect(p.review).toEqual([]);
    expect(p.ingest.companies).toEqual([
      expect.objectContaining({ name: "Fenwick Kft.", slug: "fenwick-kft" }),
    ]);
  });

  test("a person's short-form organization links to the stored company name", () => {
    const p = plan([extracted({ name: "Odo Vance", organization: "Fenwick" })]);
    expect(p.ingest.people?.[0]?.company).toBe("Fenwick Kft.");
  });
});

describe("worthExtracting", () => {
  test("a known name or a capitalised word mid-sentence is worth a call", () => {
    expect(
      worthExtracting("please ping pipster about the release", index, EXCLUDED)
    ).toBe(true);
    expect(
      worthExtracting("we met with Odo from the bank yesterday", index, EXCLUDED)
    ).toBe(true);
  });

  test("plain lowercase text, or only the user and assistant, is not", () => {
    expect(
      worthExtracting("fix the failing test in the parser please", index, EXCLUDED)
    ).toBe(false);
    expect(worthExtracting("ok so Jarvis, run it and tell Quill", index, EXCLUDED)).toBe(
      false
    );
  });
});

describe("unseenUserText", () => {
  const messages = [
    { role: "user", content: "first about Pip" },
    { role: "assistant", content: "reply" },
    { role: "user", content: "<system-reminder>x</system-reminder>" },
    { role: "user", content: "second about Odo" },
  ];

  test("returns only the user's own messages after the cursor", () => {
    expect(unseenUserText(messages, 1)).toEqual({
      text: "1. second about Odo",
      count: 2,
    });
  });
});

describe("extractSessionEntities", () => {
  test("without inference it only advances the cursor and writes nothing", async () => {
    const transcript = JSON.stringify([
      { role: "user", content: "we met Odo Vance from Northwind yesterday" },
      { role: "assistant", content: "noted" },
    ]);
    await extractSessionEntities(transcript, "session-a");
    expect(seenCount("session-a")).toBe(1);
    expect(
      existsSync(resolve(HOME, "memory", "knowledge", "People", "odo-vance.md"))
    ).toBe(false);
  });
});

describe("applying a plan", () => {
  test("ingest stores aliases and relation, and review items land in the queue", () => {
    const p = plan([
      extracted({ name: "Odo Vance", aliases: ["Odie"], relation: "client" }),
      extracted({ name: "Zsófia" }),
    ]);
    ingestEntities(p.ingest, "chat test");
    queueForReview(p.review);
    const odo = load("People", "odo-vance");
    expect(odo?.frontmatter.aliases).toEqual(["Odie"]);
    expect(odo?.frontmatter.relation).toBe("client");
    const queued = readFileSync(reviewQueueFile(), "utf-8").trim().split("\n");
    expect(queued).toHaveLength(1);
  });

  test("an update lands in the stored file even when no name or domain derives its slug", () => {
    ingestEntities(
      {
        companies: [
          { name: "Fenwick Kft.", domain: "fenwick.hu", slug: "fenwick-legacy" },
        ],
      },
      "seed"
    );
    const stored = loadNameIndex(loadKnownEntities());
    const p = planExtraction(
      [
        extracted({
          kind: "company",
          name: "Fenwick",
          existing: "fenwick-legacy",
          fact: "Signed.",
        }),
      ],
      stored,
      EXCLUDED,
      "chat test"
    );
    ingestEntities(p.ingest, "chat test");
    expect(load("Companies", "fenwick-legacy")?.body).toContain("Signed.");
    expect(load("Companies", "fenwick-kft")).toBeNull();
    expect(load("Companies", "fenwick-hu")).toBeNull();
  });
});

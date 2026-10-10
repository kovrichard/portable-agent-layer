import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { runKnowledge } from "../src/cli/knowledge";
import { loadKnownEntities, loadNameIndex } from "../src/hooks/lib/entity-cards";
import {
  type ExtractedEntity,
  planExtraction,
  queueForReview,
} from "../src/hooks/lib/entity-extraction";
import {
  acceptReview,
  pendingReviews,
  rejectReview,
} from "../src/hooks/lib/entity-review";
import { reload } from "../src/hooks/lib/settings";
import { ingestEntities } from "../src/tools/knowledge/ingest";
import { load } from "../src/tools/knowledge/lib";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const HOME = testHome(import.meta.file);

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

function queue(...items: ExtractedEntity[]): string[] {
  const index = loadNameIndex(loadKnownEntities());
  const { review } = planExtraction(items, index, [], "chat test");
  queueForReview(review);
  return review.map((r) => r.id);
}

function captureLog(): { text: () => string; restore: () => void } {
  const lines: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    lines.push(a.join(" "));
  });
  return { text: () => lines.join("\n"), restore: () => spy.mockRestore() };
}

beforeEach(() => {
  process.env.PAL_HOME = HOME;
  removeOnceReleased(HOME);
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  reload();
  ingestEntities(
    { people: [{ name: "Zsófia Berek" }, { name: "Tóvár Zsófia" }] },
    "seed"
  );
});

describe("review answers", () => {
  test("an accepted item updates the entry the user names and leaves the queue", () => {
    const [id] = queue(extracted({ name: "Zsófia", fact: "Moved to Graz." }));
    const accepted = acceptReview(id, { as: "zsofia-berek" });
    expect(accepted).toMatchObject({ slug: "zsofia-berek", created: false });
    expect(load("People", "zsofia-berek")?.body).toContain("Moved to Graz.");
    expect(load("People", "tovar-zsofia")?.body).not.toContain("Moved to Graz.");
    expect(pendingReviews()).toEqual([]);
  });

  test("an accepted item reaches an entry whose slug its name does not derive", () => {
    ingestEntities({ people: [{ name: "Pip Lanter", slug: "pip" }] }, "seed");
    const [id] = queue(extracted({ name: "Pip", fact: "Back from leave." }));
    expect(acceptReview(id, { as: "pip" })).toMatchObject({
      slug: "pip",
      created: false,
    });
    expect(load("People", "pip")?.body).toContain("Back from leave.");
    expect(load("People", "pip-lanter")).toBeNull();
  });

  test("a first name accepted with a full name becomes a new entry known by both", () => {
    const [id] = queue(extracted({ name: "Dax" }));
    expect(acceptReview(id, { name: "Dax Moreau" })).toMatchObject({
      slug: "dax-moreau",
      created: true,
    });
    expect(load("People", "dax-moreau")?.frontmatter.aliases).toEqual(["Dax"]);
  });

  test("a rejected item is dropped and nothing is written", () => {
    const [id] = queue(extracted({ name: "Dax" }));
    expect(rejectReview(id)?.entity.name).toBe("Dax");
    expect(pendingReviews()).toEqual([]);
    expect(load("People", "dax")).toBeNull();
  });

  test("an entry that does not exist is refused and the item stays queued", () => {
    const [id] = queue(extracted({ name: "Zsófia" }));
    expect(() => acceptReview(id, { as: "nobody-here" })).toThrow("nobody-here");
    expect(pendingReviews().map((i) => i.id)).toEqual([id]);
  });

  test("an unknown id changes nothing", () => {
    queue(extracted({ name: "Dax" }));
    expect(acceptReview("00000000")).toBeNull();
    expect(rejectReview("00000000")).toBeNull();
    expect(pendingReviews()).toHaveLength(1);
  });
});

describe("pal cli knowledge review", () => {
  test("lists each item with its id and candidates, then accepts one by id", async () => {
    const [id] = queue(extracted({ name: "Zsófia" }));
    const listed = captureLog();
    await runKnowledge(["review"]);
    listed.restore();
    expect(listed.text()).toContain(id);
    expect(listed.text()).toContain("could be: tovar-zsofia, zsofia-berek");

    const accepted = captureLog();
    const code = await runKnowledge(["review", "accept", id, "--as", "tovar-zsofia"]);
    accepted.restore();
    expect(code).toBe(0);
    expect(accepted.text()).toContain("Updated tovar-zsofia");
  });

  test("says so when nothing waits", async () => {
    const out = captureLog();
    await runKnowledge(["review"]);
    out.restore();
    expect(out.text()).toBe("Nothing waits for review.");
  });
});

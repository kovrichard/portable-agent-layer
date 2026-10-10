import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { runKnowledge } from "../src/cli/knowledge";
import { queueForReview, type ReviewItem } from "../src/hooks/lib/entity-extraction";
import {
  type LookupDeps,
  type LookupTarget,
  lookUpEntity,
  lookUpNewEntities,
  newLookupTargets,
} from "../src/hooks/lib/entity-lookup";
import { acceptReview, pendingReviews } from "../src/hooks/lib/entity-review";
import { reload } from "../src/hooks/lib/settings";
import { ingestEntities } from "../src/tools/knowledge/ingest";
import { load } from "../src/tools/knowledge/lib";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const HOME = testHome(import.meta.file);

const BRIGHTMOOR_EXTRACT =
  "Brightmoor is a Danish maker of industrial lighting. It was founded in 1998 in Aarhus.";
const VELLA_EXTRACT =
  "Ilse Vella is a Maltese architect. She is a partner at Corran Studio in Valletta.";

const PAGES: Record<string, unknown> = {
  "search:Brightmoor": { pages: [{ key: "Brightmoor" }, { key: "Brightmoor_(band)" }] },
  "summary:Brightmoor": {
    title: "Brightmoor",
    description: "Danish lighting company",
    extract: BRIGHTMOOR_EXTRACT,
    wikibase_item: "Q1",
    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Brightmoor" } },
  },
  "summary:Brightmoor_(band)": {
    title: "Brightmoor (band)",
    description: "Irish folk band",
    extract: "Brightmoor are an Irish folk band.",
    content_urls: {
      desktop: { page: "https://en.wikipedia.org/wiki/Brightmoor_(band)" },
    },
  },
  "claims:Q1": {
    claims: {
      P856: [{ mainsnak: { datavalue: { value: "https://www.brightmoor.dk/" } } }],
    },
  },
  "search:Ilse Vella": { pages: [{ key: "Ilse_Vella" }] },
  "summary:Ilse_Vella": {
    title: "Ilse Vella",
    description: "Maltese architect",
    extract: VELLA_EXTRACT,
    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Ilse_Vella" } },
  },
};

function pageKey(url: URL): string {
  if (url.pathname.endsWith("/search/page")) return `search:${url.searchParams.get("q")}`;
  if (url.pathname.includes("/page/summary/"))
    return `summary:${decodeURIComponent(url.pathname.split("/").pop() ?? "")}`;
  return `claims:${url.searchParams.get("entity")}`;
}

function deps(choice: Record<string, string> | null): LookupDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    principal: "the user",
    fetch: async (input) => {
      const url = new URL(String(input));
      calls.push(url.hostname);
      const body = PAGES[pageKey(url)];
      return body ? Response.json(body) : new Response("", { status: 404 });
    },
    infer: async (opts) => {
      calls.push(`infer:${opts.user}`);
      return choice
        ? { success: true, output: JSON.stringify(choice) }
        : { success: false, error: "down" };
    },
  };
}

const COMPANY: LookupTarget = {
  kind: "company",
  name: "Brightmoor",
  slug: "brightmoor",
  organization: "",
  fact: "They make the lamps for the new office.",
};
const PERSON: LookupTarget = {
  kind: "person",
  name: "Ilse Vella",
  slug: "ilse-vella",
  organization: "Corran Studio",
  fact: "Designs the new office.",
};

const COMPANY_MATCH = {
  match: "Brightmoor",
  quote: "Brightmoor is a Danish maker of industrial lighting.",
  summary: "Danish maker of industrial lighting, founded in 1998.",
};

beforeEach(() => {
  process.env.PAL_HOME = HOME;
  removeOnceReleased(HOME);
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  reload();
});

describe("newLookupTargets", () => {
  test("a new company, or a new person with an organization, is looked up", () => {
    const targets = newLookupTargets(
      {
        people: [
          { name: "Ilse Vella", company: "Corran Studio", context: "Designs it." },
          { name: "Odo Pratt", company: null },
        ],
        companies: [{ name: "Brightmoor", context: "Lamps." }],
      },
      {
        people: [
          { slug: "ilse-vella", created: true },
          { slug: "odo-pratt", created: true },
        ],
        companies: [{ slug: "brightmoor", created: true }],
      }
    );
    expect(targets.map((t) => t.slug)).toEqual(["brightmoor", "ilse-vella"]);
    expect(targets[1]).toMatchObject({
      organization: "Corran Studio",
      fact: "Designs it.",
    });
  });

  test("an entry that was only updated is not looked up again", () => {
    const targets = newLookupTargets(
      { companies: [{ name: "Brightmoor" }] },
      { people: [], companies: [{ slug: "brightmoor", created: false }] }
    );
    expect(targets).toEqual([]);
  });

  test("at most three entries are looked up per stop", () => {
    const names = ["Alder", "Birch", "Cedar", "Dogwood"];
    const targets = newLookupTargets(
      { companies: names.map((name) => ({ name })) },
      {
        people: [],
        companies: names.map((n) => ({ slug: n.toLowerCase(), created: true })),
      }
    );
    expect(targets).toHaveLength(3);
  });
});

describe("lookUpEntity", () => {
  test("a matching article becomes a review item with its summary, website and source", async () => {
    const item = await lookUpEntity(COMPANY, deps(COMPANY_MATCH));
    expect(item).toMatchObject({
      reason: "web-profile",
      source: "https://en.wikipedia.org/wiki/Brightmoor",
      candidates: ["brightmoor"],
      entity: { kind: "company", name: "Brightmoor", existing: "brightmoor" },
      profile: {
        summary: "Danish maker of industrial lighting, founded in 1998.",
        description: "Danish lighting company",
        website: "https://www.brightmoor.dk/",
        url: "https://en.wikipedia.org/wiki/Brightmoor",
      },
    });
  });

  test("the model sees what the user said and every candidate article", async () => {
    const d = deps(COMPANY_MATCH);
    await lookUpEntity(COMPANY, d);
    const prompt = d.calls.find((c) => c.startsWith("infer:")) ?? "";
    expect(prompt).toContain("They make the lamps for the new office.");
    expect(prompt).toContain(BRIGHTMOOR_EXTRACT);
    expect(prompt).toContain("Irish folk band");
  });

  test("a quote the article does not contain is not trusted", async () => {
    const item = await lookUpEntity(
      COMPANY,
      deps({ ...COMPANY_MATCH, quote: "Brightmoor makes office lamps." })
    );
    expect(item).toBeNull();
  });

  test("a person's article must name their organization", async () => {
    const match = {
      match: "Ilse Vella",
      quote: "Ilse Vella is a Maltese architect.",
      summary: "Maltese architect.",
    };
    expect(await lookUpEntity(PERSON, deps(match))).not.toBeNull();
    const elsewhere = { ...PERSON, organization: "Halden Works" };
    expect(await lookUpEntity(elsewhere, deps(match))).toBeNull();
  });

  test("no match, a title that was not offered, or a failed call yields nothing", async () => {
    expect(await lookUpEntity(COMPANY, deps({ ...COMPANY_MATCH, match: "" }))).toBeNull();
    expect(
      await lookUpEntity(
        COMPANY,
        deps({ ...COMPANY_MATCH, match: "Brightmoor Lighting" })
      )
    ).toBeNull();
    expect(await lookUpEntity(COMPANY, deps(null))).toBeNull();
  });

  test("a name with no article costs no model call", async () => {
    const d = deps(COMPANY_MATCH);
    expect(await lookUpEntity({ ...COMPANY, name: "Nowhere Ltd" }, d)).toBeNull();
    expect(d.calls.filter((c) => c.startsWith("infer:"))).toEqual([]);
  });
});

describe("lookUpNewEntities", () => {
  test("queues each profile found for review", async () => {
    await lookUpNewEntities([COMPANY], deps(COMPANY_MATCH));
    expect(pendingReviews().map((i) => i.entity.name)).toEqual(["Brightmoor"]);
  });

  test("a site that fails for one entry does not stop the others", async () => {
    const d = deps(COMPANY_MATCH);
    const failing: LookupDeps = {
      ...d,
      fetch: async (input) => {
        if (String(input).includes("Ilse")) throw new Error("offline");
        return d.fetch(input);
      },
    };
    await lookUpNewEntities([PERSON, COMPANY], failing);
    expect(pendingReviews().map((i) => i.entity.name)).toEqual(["Brightmoor"]);
  });
});

describe("accepting a web profile", () => {
  async function queuedProfile(): Promise<ReviewItem> {
    ingestEntities(
      { companies: [{ name: "Brightmoor", context: "Lamps." }] },
      "chat test"
    );
    const item = await lookUpEntity(COMPANY, deps(COMPANY_MATCH));
    if (!item) throw new Error("no profile");
    queueForReview([item]);
    return item;
  }

  test("the review list shows the summary, the official website and the article", async () => {
    const item = await queuedProfile();
    const lines: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      lines.push(a.join(" "));
    });
    await runKnowledge(["review"]);
    spy.mockRestore();
    const listed = lines.join("\n");
    expect(listed).toContain(`${item.id}  company "Brightmoor" — found on Wikipedia`);
    expect(listed).toContain("Danish maker of industrial lighting");
    expect(listed).toContain("https://www.brightmoor.dk/");
    expect(listed).toContain("from https://en.wikipedia.org/wiki/Brightmoor");
  });

  test("writes the summary and website domain into the entry it was found for", async () => {
    const item = await queuedProfile();
    const accepted = acceptReview(item.id);
    expect(accepted).toMatchObject({ slug: "brightmoor", created: false });
    const entity = load("Companies", "brightmoor");
    expect(entity?.frontmatter.domain_name).toBe("brightmoor.dk");
    expect(entity?.body).toContain("Danish maker of industrial lighting");
    expect(entity?.body).toContain("https://en.wikipedia.org/wiki/Brightmoor");
    expect(pendingReviews()).toEqual([]);
  });
});

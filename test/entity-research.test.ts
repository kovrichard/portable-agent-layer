import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { runKnowledge } from "../src/cli/knowledge";
import { researchFromCli } from "../src/cli/knowledge-research";
import type { ResearchProfile } from "../src/hooks/lib/entity-extraction";
import {
  newResearchTargets,
  type ResearchDeps,
  type ResearchTarget,
  researchEntity,
  researchNewEntities,
  researchSchema,
  researchSystem,
} from "../src/hooks/lib/entity-research";
import { acceptReview, pendingReviews } from "../src/hooks/lib/entity-review";
import type { inference } from "../src/hooks/lib/inference";
import { reload } from "../src/hooks/lib/settings";
import { ingestEntities } from "../src/tools/knowledge/ingest";
import { load } from "../src/tools/knowledge/lib";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const HOME = testHome(import.meta.file);

type InferenceCall = Parameters<typeof inference>[0];

const PROFILE: ResearchProfile = {
  match: "sure",
  summary: "Brightmoor makes industrial lighting in Debrecen.",
  role: "",
  organization: "",
  website: "https://www.brightmoor.example/",
  linkedin: "https://www.linkedin.com/company/brightmoor-example",
  socials: [{ platform: "Facebook", url: "https://facebook.com/brightmoor.example" }],
  registry: {
    name: "Brightmoor Világítás Kft.",
    number: "09-09-000000",
    taxNumber: "00000000-2-09",
    seat: "4024 Debrecen, Példa utca 1.",
    status: "active",
    managers: ["Odo Pratt"],
    url: "https://www.e-cegjegyzek.hu/?cegadatlap/0909000000/TaroltCegkivonat",
  },
  news: [
    {
      date: "2026-09-02",
      title: "Brightmoor opens a second plant",
      url: "https://news.example/brightmoor-plant",
    },
  ],
  sources: ["https://www.brightmoor.example/", "https://www.e-cegjegyzek.hu/"],
};

function deps(reply: Partial<ResearchProfile> | null, error?: string) {
  const calls: InferenceCall[] = [];
  const d: ResearchDeps = {
    principal: "the user",
    today: "2026-10-10",
    infer: async (call) => {
      calls.push(call);
      return reply
        ? { success: true, output: JSON.stringify({ ...PROFILE, ...reply }) }
        : { success: false, error };
    },
  };
  return { calls, deps: d };
}

const COMPANY: ResearchTarget = {
  kind: "company",
  name: "Brightmoor",
  slug: "brightmoor",
  organization: "",
  fact: "They make the lamps for the new office.",
};

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
});

describe("newResearchTargets", () => {
  test("a new company, or a new person with an organization, is researched", () => {
    const targets = newResearchTargets(
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

  test("an entry that was only updated is not researched again", () => {
    const targets = newResearchTargets(
      { companies: [{ name: "Brightmoor" }] },
      { people: [], companies: [{ slug: "brightmoor", created: false }] }
    );
    expect(targets).toEqual([]);
  });

  test("at most three entries are researched per stop", () => {
    const names = ["Alder", "Birch", "Cedar", "Dogwood"];
    const targets = newResearchTargets(
      { companies: names.map((name) => ({ name })) },
      {
        people: [],
        companies: names.map((n) => ({ slug: n.toLowerCase(), created: true })),
      }
    );
    expect(targets).toHaveLength(3);
  });
});

describe("researchEntity", () => {
  test("asks for a web search on the medium tier, with the checklist and what was said", async () => {
    const { calls, deps: d } = deps({});
    await researchEntity(COMPANY, d);
    expect(calls[0]).toMatchObject({ web: true, tier: "medium" });
    expect(calls[0].jsonSchema).toEqual(researchSchema());
    expect(calls[0].user).toContain("Today is 2026-10-10.");
    expect(calls[0].user).toContain("They make the lamps for the new office.");
    expect(calls[0].system).toContain("LinkedIn company page");
    expect(calls[0].system).toContain("cégjegyzék");
  });

  test("a person's checklist asks for their accounts, not a company registry", () => {
    const system = researchSystem("the user", "person");
    expect(system).toContain("LinkedIn profile");
    expect(system).toContain("X, GitHub");
    expect(system).not.toContain("cégjegyzék");
  });

  test("a sure match comes back as the profile", async () => {
    const outcome = await researchEntity(COMPANY, deps({}).deps);
    expect(outcome).toEqual({ found: true, profile: PROFILE });
  });

  test("a namesake the model is unsure of, or nothing found, is not kept", async () => {
    for (const match of ["unsure", "none"] as const) {
      const outcome = await researchEntity(COMPANY, deps({ match }).deps);
      expect(outcome.found).toBe(false);
    }
  });

  test("a link that is not a web URL is dropped, and a profile with no source is not kept", async () => {
    const outcome = await researchEntity(
      COMPANY,
      deps({
        linkedin: "linkedin.com/company/brightmoor",
        socials: [{ platform: "X", url: "@brightmoor" }],
      }).deps
    );
    expect(outcome.found && outcome.profile.linkedin).toBe("");
    expect(outcome.found && outcome.profile.socials).toEqual([]);
    const sourceless = await researchEntity(
      COMPANY,
      deps({ sources: ["somewhere"] }).deps
    );
    expect(sourceless).toEqual({ found: false, reason: "no sources given" });
  });

  test("an agent that cannot search says why", async () => {
    const outcome = await researchEntity(
      COMPANY,
      deps(null, "web research is not available on opencode yet").deps
    );
    expect(outcome).toEqual({
      found: false,
      reason: "web research is not available on opencode yet",
    });
  });
});

describe("researchNewEntities", () => {
  test("queues each sure profile for review against its entry", async () => {
    await researchNewEntities([COMPANY], deps({}).deps);
    const [item] = pendingReviews();
    expect(item).toMatchObject({
      reason: "web-profile",
      candidates: ["brightmoor"],
      entity: { kind: "company", name: "Brightmoor", existing: "brightmoor" },
      profile: PROFILE,
    });
  });

  test("a failure for one entry does not stop the others", async () => {
    const { deps: d } = deps({});
    const failing: ResearchDeps = {
      ...d,
      infer: async (call) => {
        if (call.user.includes("Ilse")) throw new Error("offline");
        return d.infer(call);
      },
    };
    const person = {
      ...COMPANY,
      kind: "person" as const,
      name: "Ilse Vella",
      slug: "ilse-vella",
    };
    await researchNewEntities([person, COMPANY], failing);
    expect(pendingReviews().map((i) => i.entity.name)).toEqual(["Brightmoor"]);
  });
});

describe("accepting a researched profile", () => {
  async function queued(): Promise<string> {
    ingestEntities(
      { companies: [{ name: "Brightmoor", context: "Lamps." }] },
      "chat test"
    );
    await researchNewEntities([COMPANY], deps({}).deps);
    return pendingReviews()[0].id;
  }

  test("the review list shows the whole profile", async () => {
    const id = await queued();
    const out = captureLog();
    await runKnowledge(["review"]);
    out.restore();
    expect(out.text()).toContain(`${id}  company "Brightmoor" — found on the web`);
    for (const shown of [
      "https://www.linkedin.com/company/brightmoor-example",
      "Registration number: 09-09-000000",
      "2026-09-02 Brightmoor opens a second plant",
    ])
      expect(out.text()).toContain(shown);
  });

  test("writes the profile and the website domain into the entry it was found for", async () => {
    const id = await queued();
    expect(acceptReview(id)).toMatchObject({ slug: "brightmoor", created: false });
    const entity = load("Companies", "brightmoor");
    expect(entity?.frontmatter.domain_name).toBe("brightmoor.example");
    expect(entity?.body).toContain("Tax number: 00000000-2-09");
    expect(entity?.body).toContain(
      "LinkedIn: https://www.linkedin.com/company/brightmoor-example"
    );
    expect(pendingReviews()).toEqual([]);
  });

  test("a person's accounts land in their socials", async () => {
    ingestEntities({ people: [{ name: "Ilse Vella" }] }, "chat test");
    const person: ResearchTarget = {
      kind: "person",
      name: "Ilse Vella",
      slug: "ilse-vella",
      organization: "Corran Studio",
      fact: "",
    };
    await researchNewEntities(
      [person],
      deps({
        role: "Architect",
        website: "https://ilsevella.example/",
        linkedin: "https://www.linkedin.com/in/ilse-vella-example",
        socials: [{ platform: "GitHub", url: "https://github.com/ilsevella-example" }],
      }).deps
    );
    acceptReview(pendingReviews()[0].id);
    const entity = load("People", "ilse-vella");
    expect(entity?.frontmatter.position).toBe("Architect");
    expect(entity?.frontmatter.socials).toEqual(
      expect.arrayContaining([
        "linkedin:https://www.linkedin.com/in/ilse-vella-example",
        "github:https://github.com/ilsevella-example",
        "website:https://ilsevella.example/",
      ])
    );
  });
});

describe("pal cli knowledge research", () => {
  test("prints the profile of a company not yet in the store", async () => {
    const { calls, deps: d } = deps({});
    const out = captureLog();
    const code = await researchFromCli("Brightmoor", { context: "Lamp maker." }, d);
    out.restore();
    expect(code).toBe(0);
    expect(calls[0].user).toContain("company: Brightmoor");
    expect(calls[0].user).toContain("Lamp maker.");
    expect(out.text()).toContain("Registration number: 09-09-000000");
    expect(pendingReviews()).toEqual([]);
  });

  test("researches a person at their organization", async () => {
    const { calls, deps: d } = deps({});
    const out = captureLog();
    await researchFromCli(
      "Ilse Vella",
      { person: true, organization: "Corran Studio" },
      d
    );
    out.restore();
    expect(calls[0].user).toContain("person: Ilse Vella\norganization: Corran Studio");
  });

  test("--queue puts it in review against the stored entry", async () => {
    ingestEntities({ companies: [{ name: "Brightmoor" }] }, "chat test");
    const out = captureLog();
    await researchFromCli("Brightmoor", { queue: true }, deps({}).deps);
    out.restore();
    const [item] = pendingReviews();
    expect(item.entity.existing).toBe("brightmoor");
    expect(out.text()).toContain(`pal cli knowledge review accept ${item.id}`);
  });

  test("--json prints the profile as JSON", async () => {
    const out = captureLog();
    await researchFromCli("Brightmoor", { json: true }, deps({}).deps);
    out.restore();
    expect(JSON.parse(out.text())).toEqual(PROFILE);
  });

  test("exits 1 and says why when nothing sure was found", async () => {
    const errors: string[] = [];
    const spy = spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      errors.push(a.join(" "));
    });
    const code = await researchFromCli("Brightmoor", {}, deps({ match: "unsure" }).deps);
    spy.mockRestore();
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("match: unsure");
  });
});

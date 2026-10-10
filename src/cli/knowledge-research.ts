/**
 * pal cli knowledge research — research one person or company on the web through
 * the active agent, print the profile, and optionally queue it for review.
 */

import { loadKnownEntities, loadNameIndex } from "../hooks/lib/entity-cards";
import { queueForReview } from "../hooks/lib/entity-extraction";
import { lookupName } from "../hooks/lib/entity-names";
import {
  type ResearchDeps,
  type ResearchTarget,
  renderProfile,
  researchEntity,
  researchItem,
} from "../hooks/lib/entity-research";
import { inference } from "../hooks/lib/inference";
import { identity } from "../hooks/lib/settings";
import { leaf, UsageError } from "../tools/lib/command";

interface ResearchValues {
  person?: boolean;
  organization?: string;
  context?: string;
  queue?: boolean;
  json?: boolean;
}

function storedSlug(name: string, kind: ResearchTarget["kind"]): string {
  const domain = kind === "person" ? "People" : "Companies";
  const { entities, exact } = lookupName(name, loadNameIndex(loadKnownEntities()));
  const matches = entities.filter((e) => e.domain === domain);
  return exact && matches.length === 1 ? matches[0].slug : "";
}

function targetFrom(name: string, values: ResearchValues): ResearchTarget {
  const kind = values.person ? "person" : "company";
  return {
    kind,
    name,
    slug: storedSlug(name, kind),
    organization: values.organization ?? "",
    fact: values.context ?? "",
  };
}

export async function researchFromCli(
  name: string | undefined,
  values: ResearchValues,
  deps: ResearchDeps = { principal: identity().principal.name, infer: inference }
): Promise<number> {
  if (!name?.trim()) throw new UsageError("name the person or company to research");
  const target = targetFrom(name.trim(), values);
  const outcome = await researchEntity(target, deps);
  if (!outcome.found) {
    console.error(`Nothing kept for "${target.name}": ${outcome.reason}`);
    return 1;
  }
  console.log(
    values.json
      ? JSON.stringify(outcome.profile, null, 2)
      : renderProfile(outcome.profile)
  );
  if (values.queue) {
    const item = researchItem(target, outcome.profile);
    queueForReview([item]);
    console.log(`\nQueued for review: pal cli knowledge review accept ${item.id}`);
  }
  return 0;
}

export const researchCommand = leaf({
  summary: "Research a company (or --person) on the web: links, registry, news",
  args: "<name>",
  options: {
    person: { type: "boolean", description: "Research a person, not a company" },
    organization: {
      type: "string",
      value: "<name>",
      description: "Where the person works, to tell namesakes apart",
    },
    context: {
      type: "string",
      value: "<text>",
      description: "What you know about them, to tell namesakes apart",
    },
    queue: {
      type: "boolean",
      description: "Also queue the profile for `pal cli knowledge review`",
    },
    json: { type: "boolean", description: "Print the profile as JSON" },
  },
  run: ({ positionals, values }) => researchFromCli(positionals.join(" "), values),
});

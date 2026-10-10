/**
 * Looking up a newly learned company, or a person whose organization is known, on
 * Wikipedia. A matching article becomes a profile in the review queue; nothing is
 * written to the store until the user accepts it.
 */

import type { IngestInput, IngestResult } from "../../tools/knowledge/ingest";
import {
  closedObject,
  type ExtractedEntity,
  queueForReview,
  type ReviewItem,
  type WebProfile,
} from "./entity-extraction";
import { foldName } from "./entity-names";
import type { inference } from "./inference";
import { logDebug, logError } from "./log";
import { logTokenUsage } from "./token-usage";

export interface LookupTarget {
  kind: ExtractedEntity["kind"];
  name: string;
  slug: string;
  organization: string;
  fact: string;
}

export interface LookupDeps {
  principal: string;
  fetch: (input: string) => Promise<Response>;
  infer: typeof inference;
}

interface Article {
  title: string;
  description: string;
  extract: string;
  url: string;
  wikidata: string;
}

interface Choice {
  match: string;
  quote: string;
  summary: string;
}

const WIKIPEDIA = "https://en.wikipedia.org";
const WIKIDATA = "https://www.wikidata.org/w/api.php";
const USER_AGENT =
  "PAL-entity-lookup (https://github.com/kovrichard/portable-agent-layer)";
const MAX_TARGETS = 3;
const MAX_ARTICLES = 3;
const REQUEST_TIMEOUT_MS = 15000;

function created(written: IngestResult["people"]): Set<string> {
  return new Set(written.filter((w) => w.created).map((w) => w.slug));
}

/** New companies, and new people with an organization to tell namesakes apart by. */
export function newLookupTargets(
  input: IngestInput,
  written: IngestResult
): LookupTarget[] {
  const newCompanies = created(written.companies);
  const newPeople = created(written.people);
  const companies = (input.companies ?? []).flatMap((c, i) => {
    const slug = written.companies[i]?.slug ?? "";
    return newCompanies.has(slug)
      ? [
          {
            kind: "company" as const,
            name: c.name,
            slug,
            organization: "",
            fact: c.context ?? "",
          },
        ]
      : [];
  });
  const people = (input.people ?? []).flatMap((p, i) => {
    const slug = written.people[i]?.slug ?? "";
    return newPeople.has(slug) && p.company
      ? [
          {
            kind: "person" as const,
            name: p.name,
            slug,
            organization: p.company,
            fact: p.context ?? "",
          },
        ]
      : [];
  });
  return [...companies, ...people].slice(0, MAX_TARGETS);
}

async function getJson<T>(url: string, deps: LookupDeps): Promise<T | null> {
  const response = await deps.fetch(url);
  return response.ok ? ((await response.json()) as T) : null;
}

async function searchKeys(name: string, deps: LookupDeps): Promise<string[]> {
  const q = encodeURIComponent(name);
  const data = await getJson<{ pages?: { key: string }[] }>(
    `${WIKIPEDIA}/w/rest.php/v1/search/page?q=${q}&limit=${MAX_ARTICLES}`,
    deps
  );
  return (data?.pages ?? []).map((p) => p.key);
}

interface Summary {
  type?: string;
  title?: string;
  description?: string;
  extract?: string;
  wikibase_item?: string;
  content_urls?: { desktop?: { page?: string } };
}

async function article(key: string, deps: LookupDeps): Promise<Article[]> {
  const s = await getJson<Summary>(
    `${WIKIPEDIA}/api/rest_v1/page/summary/${encodeURIComponent(key)}`,
    deps
  );
  if (!s?.extract || !s.title || s.type === "disambiguation") return [];
  return [
    {
      title: s.title,
      description: s.description ?? "",
      extract: s.extract,
      url: s.content_urls?.desktop?.page ?? `${WIKIPEDIA}/wiki/${key}`,
      wikidata: s.wikibase_item ?? "",
    },
  ];
}

interface Claims {
  claims?: { P856?: { mainsnak?: { datavalue?: { value?: string } } }[] };
}

async function officialWebsite(wikidata: string, deps: LookupDeps): Promise<string> {
  if (!wikidata) return "";
  const data = await getJson<Claims>(
    `${WIKIDATA}?action=wbgetclaims&entity=${wikidata}&property=P856&format=json`,
    deps
  );
  return data?.claims?.P856?.[0]?.mainsnak?.datavalue?.value ?? "";
}

function choiceSchema() {
  const text = { type: "string" as const };
  return closedObject({ match: text, quote: text, summary: text });
}

function choiceSystem(principal: string, kind: LookupTarget["kind"]): string {
  return [
    `You match a ${kind} from ${principal}'s contact book to an encyclopedia article.`,
    `- match: the title of the article that is clearly about this same ${kind}, or empty when none is. A shared name alone is not enough.`,
    "- quote: one sentence copied exactly from that article's text that shows it is the same one.",
    "- summary: one or two sentences, from the article only, on who they are or what the company does.",
    "When match is empty, leave quote and summary empty too.",
  ].join("\n");
}

function choiceUser(target: LookupTarget, articles: Article[]): string {
  const contact = [
    `${target.kind}: ${target.name}`,
    target.organization && `organization: ${target.organization}`,
    target.fact && `what was said: ${target.fact}`,
  ].filter(Boolean);
  const listed = articles.map((a) => `## ${a.title}\n${a.description}\n${a.extract}`);
  return `${contact.join("\n")}\n\nArticles:\n\n${listed.join("\n\n")}`;
}

function squeezed(text: string): string {
  return foldName(text).replace(/\s+/g, " ");
}

function backedArticle(
  choice: Choice,
  articles: Article[],
  target: LookupTarget
): Article | null {
  const chosen = articles.find((a) => a.title === choice.match);
  if (!chosen || !choice.quote.trim()) return null;
  const text = squeezed(chosen.extract);
  if (!text.includes(squeezed(choice.quote))) return null;
  if (target.kind === "person" && !text.includes(squeezed(target.organization)))
    return null;
  return chosen;
}

function parseChoice(output: string | undefined): Choice | null {
  try {
    return output ? (JSON.parse(output) as Choice) : null;
  } catch {
    return null;
  }
}

async function chooseArticle(
  target: LookupTarget,
  articles: Article[],
  deps: LookupDeps
): Promise<{ article: Article; summary: string } | null> {
  const result = await deps.infer({
    system: choiceSystem(deps.principal, target.kind),
    user: choiceUser(target, articles),
    tier: "medium",
    maxTokens: 400,
    timeout: 90000,
    jsonSchema: choiceSchema(),
    caller: "entity-lookup",
  });
  if (result.usage) logTokenUsage("entity-lookup", result.usage);
  const choice = result.success ? parseChoice(result.output) : null;
  if (!choice) return null;
  const chosen = backedArticle(choice, articles, target);
  return chosen ? { article: chosen, summary: choice.summary.trim() } : null;
}

function profileItem(target: LookupTarget, profile: WebProfile): ReviewItem {
  return {
    id: crypto.randomUUID().slice(0, 8),
    ts: new Date().toISOString(),
    source: profile.url,
    reason: "web-profile",
    entity: {
      kind: target.kind,
      name: target.name,
      existing: target.slug,
      aliases: [],
      role: "",
      organization: target.organization,
      relation: "",
      fact: profile.summary,
    },
    candidates: [target.slug],
    profile,
  };
}

export async function lookUpEntity(
  target: LookupTarget,
  deps: LookupDeps
): Promise<ReviewItem | null> {
  const keys = await searchKeys(target.name, deps);
  const articles = (await Promise.all(keys.map((k) => article(k, deps)))).flat();
  if (articles.length === 0) return null;
  const chosen = await chooseArticle(target, articles, deps);
  if (!chosen) return null;
  const { article: a, summary } = chosen;
  return profileItem(target, {
    summary: summary || a.description,
    description: a.description,
    website: await officialWebsite(a.wikidata, deps),
    url: a.url,
  });
}

async function lookUpOrLog(
  target: LookupTarget,
  deps: LookupDeps
): Promise<ReviewItem[]> {
  try {
    const item = await lookUpEntity(target, deps);
    return item ? [item] : [];
  } catch (err) {
    logError(`entity-lookup:${target.slug}`, err);
    return [];
  }
}

export async function lookUpNewEntities(
  targets: LookupTarget[],
  deps: LookupDeps
): Promise<void> {
  const found = (await Promise.all(targets.map((t) => lookUpOrLog(t, deps)))).flat();
  queueForReview(found);
  logDebug("entity-lookup", `${found.length} of ${targets.length} found for review`);
}

/** The accepted profile, written to the entry it was found for. */
export function profileIngest(item: ReviewItem, name: string): IngestInput {
  const profile = item.profile as WebProfile;
  const slug = item.entity.existing;
  if (item.entity.kind === "person")
    return { people: [{ name, slug, context: profile.summary }] };
  const domain = profile.website
    ? new URL(profile.website).hostname.replace(/^www\./, "")
    : null;
  return { companies: [{ name, slug, domain, context: profile.summary }] };
}

export function lookupDeps(principal: string, infer: typeof inference): LookupDeps {
  return {
    principal,
    infer,
    fetch: (url) =>
      fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
  };
}

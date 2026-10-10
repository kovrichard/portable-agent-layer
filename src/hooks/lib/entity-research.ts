/**
 * Researching a person or company on the web: website, LinkedIn, social accounts,
 * the company registry entry and recent news, each with its source. A profile only
 * reaches the store through the review queue.
 */

import type { IngestInput, IngestResult } from "../../tools/knowledge/ingest";
import {
  closedObject,
  type ExtractedEntity,
  queueForReview,
  type ResearchProfile,
  type ReviewItem,
} from "./entity-extraction";
import type { inference } from "./inference";
import { logDebug, logError } from "./log";
import { logTokenUsage } from "./token-usage";

export interface ResearchTarget {
  kind: ExtractedEntity["kind"];
  name: string;
  slug: string;
  organization: string;
  fact: string;
}

export interface ResearchDeps {
  principal: string;
  infer: typeof inference;
  today?: string;
}

const MAX_TARGETS = 3;
const RESEARCH_TIMEOUT_MS = 480_000;

function created(written: IngestResult["people"]): Set<string> {
  return new Set(written.filter((w) => w.created).map((w) => w.slug));
}

function target(
  kind: ResearchTarget["kind"],
  name: string,
  slug: string,
  organization: string | null | undefined,
  fact: string | null | undefined
): ResearchTarget {
  return { kind, name, slug, organization: organization ?? "", fact: fact ?? "" };
}

/** New companies, and new people with an organization to tell namesakes apart by. */
export function newResearchTargets(
  input: IngestInput,
  written: IngestResult
): ResearchTarget[] {
  const newCompanies = created(written.companies);
  const newPeople = created(written.people);
  const companies = (input.companies ?? []).flatMap((c, i) => {
    const slug = written.companies[i]?.slug ?? "";
    return newCompanies.has(slug) ? [target("company", c.name, slug, "", c.context)] : [];
  });
  const people = (input.people ?? []).flatMap((p, i) => {
    const slug = written.people[i]?.slug ?? "";
    return newPeople.has(slug) && p.company
      ? [target("person", p.name, slug, p.company, p.context)]
      : [];
  });
  return [...companies, ...people].slice(0, MAX_TARGETS);
}

export function researchSchema() {
  const text = { type: "string" as const };
  const list = (items: Record<string, unknown>) => ({ type: "array" as const, items });
  return closedObject({
    match: { type: "string" as const, enum: ["sure", "unsure", "none"] },
    summary: text,
    role: text,
    organization: text,
    website: text,
    linkedin: text,
    socials: list(closedObject({ platform: text, url: text })),
    registry: closedObject({
      name: text,
      number: text,
      taxNumber: text,
      seat: text,
      status: text,
      managers: list(text),
      url: text,
    }),
    news: list(closedObject({ date: text, title: text, url: text })),
    sources: list(text),
  });
}

const CHECKLIST = {
  company: [
    "- website: the official website.",
    "- linkedin: the LinkedIn company page.",
    "- socials: other official accounts (X, Facebook, Instagram, YouTube, GitHub).",
    "- registry: its entry in the official company register of its country: registered name, registration number, tax number, registered seat, status (active, in liquidation…), managing directors, and the URL you read it on. For a Hungarian company (Kft., Zrt., Bt., Nyrt., a .hu site) that is the cégjegyzék: e-cegjegyzek.hu, or public mirrors such as ceginformacio.hu, nemzeticegtar.hu or opten.hu.",
    "- news: up to five news items or public statements from the last 12 months, newest first.",
    "- summary: two or three sentences on what the company does, its size and where it is based.",
  ],
  person: [
    "- role and organization: their current position and employer.",
    "- website: their own site, if they have one.",
    "- linkedin: their LinkedIn profile.",
    "- socials: their accounts on X, GitHub, Instagram, YouTube or similar.",
    "- news: up to five recent news items, interviews, talks or public statements from the last 12 months, newest first.",
    "- summary: two or three sentences on who they are and what they work on.",
  ],
};

export function researchSystem(principal: string, kind: ResearchTarget["kind"]): string {
  return [
    `You research a ${kind} from ${principal}'s contact book on the web. Search the web and open pages; do not answer from memory.`,
    "Find:",
    ...CHECKLIST[kind],
    "Rules:",
    `- match: "sure" when what you found is clearly this ${kind} (the same name AND it fits what ${principal} said about them), "unsure" when you found namesakes and cannot tell which, "none" when you found nothing. Only "sure" profiles are kept.`,
    "- Only state what a page you opened or a search result shows. Never guess a URL, number or date.",
    "- Every URL must be one you saw. List every page you used in sources.",
    "- Leave a field empty, or a list empty, when you did not find it.",
    "- Dates as YYYY-MM-DD, or YYYY-MM when the day is not given.",
  ].join("\n");
}

function researchUser(target: ResearchTarget, today: string): string {
  return [
    `Today is ${today}.`,
    `${target.kind}: ${target.name}`,
    target.organization && `organization: ${target.organization}`,
    target.fact &&
      `what ${target.kind === "person" ? "was said about them" : "was said about it"}: ${target.fact}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseProfile(output: string | undefined): ResearchProfile | null {
  try {
    return output ? (JSON.parse(output) as ResearchProfile) : null;
  } catch {
    return null;
  }
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+$/.test(url);
}

/** Drops any link that is not a plain http(s) URL, so the store never holds a guess dressed as one. */
function withWebUrlsOnly(p: ResearchProfile): ResearchProfile {
  const url = (u: string) => (isWebUrl(u) ? u : "");
  return {
    ...p,
    website: url(p.website),
    linkedin: url(p.linkedin),
    socials: p.socials.filter((s) => isWebUrl(s.url)),
    registry: { ...p.registry, url: url(p.registry.url) },
    news: p.news.filter((n) => isWebUrl(n.url)),
    sources: p.sources.filter(isWebUrl),
  };
}

export type ResearchOutcome =
  | { found: true; profile: ResearchProfile }
  | { found: false; reason: string };

export async function researchEntity(
  target: ResearchTarget,
  deps: ResearchDeps
): Promise<ResearchOutcome> {
  const result = await deps.infer({
    system: researchSystem(deps.principal, target.kind),
    user: researchUser(target, deps.today ?? new Date().toISOString().slice(0, 10)),
    tier: "medium",
    timeout: RESEARCH_TIMEOUT_MS,
    jsonSchema: researchSchema(),
    caller: "entity-research",
    web: true,
  });
  if (result.usage) logTokenUsage("entity-research", result.usage);
  const profile = result.success ? parseProfile(result.output) : null;
  if (!profile) return { found: false, reason: result.error ?? "no usable reply" };
  if (profile.match !== "sure")
    return { found: false, reason: `match: ${profile.match}. ${profile.summary}`.trim() };
  const checked = withWebUrlsOnly(profile);
  if (checked.sources.length === 0) return { found: false, reason: "no sources given" };
  return { found: true, profile: checked };
}

export function researchItem(
  target: ResearchTarget,
  profile: ResearchProfile
): ReviewItem {
  return {
    id: crypto.randomUUID().slice(0, 8),
    ts: new Date().toISOString(),
    source: profile.sources[0],
    reason: "web-profile",
    entity: {
      kind: target.kind,
      name: target.name,
      existing: target.slug,
      aliases: [],
      role: profile.role,
      organization: profile.organization || target.organization,
      relation: "",
      fact: profile.summary,
    },
    candidates: target.slug ? [target.slug] : [],
    profile,
  };
}

async function researchOrLog(
  target: ResearchTarget,
  deps: ResearchDeps
): Promise<ReviewItem[]> {
  try {
    const outcome = await researchEntity(target, deps);
    if (outcome.found) return [researchItem(target, outcome.profile)];
    logDebug("entity-research", `${target.slug}: ${outcome.reason}`);
    return [];
  } catch (err) {
    logError(`entity-research:${target.slug}`, err);
    return [];
  }
}

export async function researchNewEntities(
  targets: ResearchTarget[],
  deps: ResearchDeps
): Promise<void> {
  const found = (await Promise.all(targets.map((t) => researchOrLog(t, deps)))).flat();
  queueForReview(found);
  logDebug("entity-research", `${found.length} of ${targets.length} found for review`);
}

function registryLines(r: ResearchProfile["registry"]): string[] {
  const fields: Array<[string, string]> = [
    ["Registered name", r.name],
    ["Registration number", r.number],
    ["Tax number", r.taxNumber],
    ["Seat", r.seat],
    ["Status", r.status],
    ["Managing directors", r.managers.join(", ")],
    ["Registry entry", r.url],
  ];
  return fields.filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`);
}

function section(title: string, lines: string[]): string[] {
  return lines.length > 0 ? ["", `**${title}**`, ...lines] : [];
}

/** The profile as markdown: what the review list shows and what an accepted entry keeps. */
export function renderProfile(p: ResearchProfile): string {
  const links = [
    p.website && `- Website: ${p.website}`,
    p.linkedin && `- LinkedIn: ${p.linkedin}`,
    ...p.socials.map((s) => `- ${s.platform}: ${s.url}`),
  ].filter((l): l is string => Boolean(l));
  return [
    p.summary,
    ...section("Links", links),
    ...section("Registry", registryLines(p.registry)),
    ...section(
      "News",
      p.news.map((n) => `- ${n.date} ${n.title} (${n.url})`)
    ),
    ...section(
      "Sources",
      p.sources.map((s) => `- ${s}`)
    ),
  ].join("\n");
}

function socialKey(platform: string): string {
  return platform.toLowerCase().replace(/[^a-z0-9]+/g, "") || "link";
}

function hostname(url: string): string | null {
  return url ? new URL(url).hostname.replace(/^www\./, "") : null;
}

/** The accepted profile, written to the entry it was researched for. */
export function profileIngest(item: ReviewItem, name: string): IngestInput {
  const p = item.profile as ResearchProfile;
  const slug = item.entity.existing || null;
  const context = renderProfile(p);
  if (item.entity.kind === "company")
    return { companies: [{ name, slug, domain: hostname(p.website), context }] };
  const social = Object.fromEntries(
    [
      ["website", p.website],
      ["linkedin", p.linkedin],
      ...p.socials.map((s) => [socialKey(s.platform), s.url]),
    ].filter(([, url]) => url)
  );
  return {
    people: [{ name, slug, title: p.role || null, social, context }],
  };
}

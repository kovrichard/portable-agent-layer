/**
 * Turning what the user said about people and companies into knowledge-store
 * writes. A clear match or a new name is written; a name that could be more than
 * one known entity waits in the review queue instead of being guessed.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CompanyInput,
  IngestInput,
  PersonInput,
} from "../../tools/knowledge/ingest";
import {
  findMentions,
  foldName,
  indexedEntities,
  isExcluded,
  lookupName,
  type NamedEntity,
  type NameIndex,
  proseOnly,
} from "./entity-names";
import { paths } from "./paths";
import { isSystemText, stripInjectedTags } from "./prompt-text";

export interface ExtractedEntity {
  kind: "person" | "company";
  name: string;
  existing: string;
  aliases: string[];
  role: string;
  organization: string;
  relation: string;
  fact: string;
}

export interface ResearchProfile {
  match: "sure" | "unsure" | "none";
  summary: string;
  role: string;
  organization: string;
  website: string;
  linkedin: string;
  socials: { platform: string; url: string }[];
  registry: {
    name: string;
    number: string;
    taxNumber: string;
    seat: string;
    status: string;
    managers: string[];
    url: string;
  };
  news: { date: string; title: string; url: string }[];
  sources: string[];
}

export interface ReviewItem {
  ts: string;
  source: string;
  id: string;
  reason: "ambiguous" | "unknown-existing" | "first-name-only" | "web-profile";
  entity: ExtractedEntity;
  candidates: string[];
  profile?: ResearchProfile;
}

export interface ExtractionPlan {
  ingest: IngestInput;
  review: ReviewItem[];
}

export function closedObject<P extends Record<string, unknown>>(properties: P) {
  return {
    type: "object" as const,
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

export function extractionSchema() {
  const text = { type: "string" as const };
  const entity = closedObject({
    kind: { type: "string" as const, enum: ["person", "company"] },
    name: text,
    existing: text,
    aliases: { type: "array" as const, items: text },
    role: text,
    organization: text,
    relation: text,
    fact: text,
  });
  return closedObject({ entities: { type: "array" as const, items: entity } });
}

const MAX_TEXT = 4000;
const MIN_TEXT = 20;
const MAX_KNOWN = 120;
const CURSOR_KEEP = 200;

interface Message {
  role: string;
  content: unknown;
}

function userTexts(messages: Message[]): string[] {
  return messages
    .filter((m) => m.role === "user" && typeof m.content === "string")
    .map((m) => stripInjectedTags(m.content as string))
    .filter((t) => t.length > 0 && !isSystemText(t));
}

/** The user's words since the last extraction, and the new high-water mark. */
export function unseenUserText(
  messages: Message[],
  seen: number
): { text: string; count: number } {
  const texts = userTexts(messages);
  const fresh = texts.slice(Math.min(seen, texts.length));
  const text = fresh.map((t, i) => `${i + 1}. ${proseOnly(t).trim()}`).join("\n");
  return { text: text.slice(-MAX_TEXT), count: texts.length };
}

function hasUnknownProperName(text: string, ignored: Set<string>): boolean {
  const sentences = proseOnly(text).split(/[.!?\n]+/);
  return sentences.some((s) =>
    s
      .trim()
      .split(/\s+/)
      .slice(1)
      .some((w) => /^\p{Lu}\p{Ll}/u.test(w) && !ignored.has(foldName(w)))
  );
}

/** Cheap gate before a model call: a known name, or a capitalised word mid-sentence. */
export function worthExtracting(
  text: string,
  index: NameIndex,
  excluded: string[]
): boolean {
  if (proseOnly(text).trim().length < MIN_TEXT) return false;
  if (findMentions(text, index).length > 0) return true;
  return hasUnknownProperName(text, new Set(excluded.map(foldName)));
}

function knownLine(entity: NamedEntity): string {
  const aliases =
    entity.aliases.length > 0 ? ` (also: ${entity.aliases.join(", ")})` : "";
  const kind = entity.domain === "People" ? "person" : "company";
  return `${entity.slug} | ${kind} | ${entity.title}${aliases}`;
}

export function extractionSystem(principal: string, assistant: string): string {
  return [
    `You keep a contact book for ${principal}. From ${principal}'s own messages to an AI assistant, list the people and companies ${principal} talks about as part of their work and life.`,
    `- Never list ${principal} or the assistant (${assistant}).`,
    `- People: individuals ${principal} deals with (colleagues, clients, partners, friends, family, contacts). Skip public figures cited only for their work.`,
    `- Companies: only organisations ${principal} has a relationship with: employer, own company, client, prospect, partner, contractor, school. Skip tools, products, platforms, languages and vendors that are merely used or discussed.`,
    "- existing: the slug of the matching known entry below, or empty when it is someone new.",
    "- aliases: other names the messages use for it (nickname, short form), not the main name.",
    `- role, organization (a person's company), relation (how ${principal} relates to it: client, partner, colleague, friend, employer, prospect, own company): only what the messages state, else empty.`,
    "- fact: one sentence of what the messages state about it, else empty. Never guess.",
    "- Ignore names that appear only inside pasted logs, code or email headers.",
    "Return an empty list when nobody qualifies.",
  ].join("\n");
}

export function extractionUser(text: string, index: NameIndex): string {
  const known = indexedEntities(index)
    .filter((e) => !isExcluded(e, index))
    .slice(0, MAX_KNOWN)
    .map(knownLine);
  return `Known entries (slug | kind | name):\n${known.join("\n") || "(none)"}\n\nMessages:\n${text}`;
}

function domainOf(kind: ExtractedEntity["kind"]): NamedEntity["domain"] {
  return kind === "person" ? "People" : "Companies";
}

function namesUser(e: ExtractedEntity, excluded: string[]): boolean {
  const own = new Set(excluded.filter(Boolean).map(foldName));
  return [e.name, ...e.aliases].some((n) => own.has(foldName(n)));
}

type Resolution =
  | { kind: "new" }
  | { kind: "known"; entity: NamedEntity }
  | { kind: "review"; reason: ReviewItem["reason"]; candidates: NamedEntity[] };

function resolveExisting(e: ExtractedEntity, sameDomain: NamedEntity[]): Resolution {
  const entity = sameDomain.find((c) => c.slug === e.existing);
  return entity
    ? { kind: "known", entity }
    : { kind: "review", reason: "unknown-existing", candidates: [] };
}

/** "Dan" alone may be a known Daniel under a nickname the store hasn't seen yet. */
function newcomer(e: ExtractedEntity): Resolution {
  const firstNameOnly = e.kind === "person" && !/\s/.test(e.name.trim());
  return firstNameOnly
    ? { kind: "review", reason: "first-name-only", candidates: [] }
    : { kind: "new" };
}

function resolveEntity(e: ExtractedEntity, index: NameIndex): Resolution {
  const domain = domainOf(e.kind);
  const sameDomain = indexedEntities(index).filter((c) => c.domain === domain);
  if (e.existing) return resolveExisting(e, sameDomain);
  const { entities, exact } = lookupName(e.name, index);
  const candidates = entities.filter((c) => c.domain === domain);
  if (candidates.length === 0) return newcomer(e);
  if (exact && candidates.length === 1) return { kind: "known", entity: candidates[0] };
  return { kind: "review", reason: "ambiguous", candidates };
}

function otherNames(e: ExtractedEntity, storedName: string): string[] {
  const names = [e.name, ...e.aliases].map((n) => n.trim()).filter(Boolean);
  return [...new Set(names)].filter((n) => foldName(n) !== foldName(storedName));
}

/** "Acme" for a stored "Acme Kft." links the person to that file, not a new stub. */
function storedOrganization(organization: string, index: NameIndex): string | null {
  if (!organization.trim()) return null;
  const { entities, exact } = lookupName(organization, index);
  const companies = entities.filter((c) => c.domain === "Companies");
  return exact && companies.length === 1 ? companies[0].title : organization;
}

function personInput(
  e: ExtractedEntity,
  name: string,
  index: NameIndex,
  slug: string | null
): PersonInput {
  return {
    name,
    slug,
    role: e.role || null,
    company: storedOrganization(e.organization, index),
    context: e.fact || null,
    aliases: otherNames(e, name),
    relation: e.relation || null,
  };
}

function companyInput(
  e: ExtractedEntity,
  name: string,
  slug: string | null
): CompanyInput {
  return {
    name,
    slug,
    context: e.fact || null,
    aliases: otherNames(e, name),
    relation: e.relation || null,
  };
}

/** Ingest input for one extracted entity: the known file it updates, or a new one. */
export function ingestInput(
  e: ExtractedEntity,
  index: NameIndex,
  known: NamedEntity | null,
  newName?: string
): IngestInput {
  const name = known?.title ?? (newName?.trim() || e.name.trim());
  const slug = known?.slug ?? null;
  return e.kind === "person"
    ? { people: [personInput(e, name, index, slug)] }
    : { companies: [companyInput(e, name, slug)] };
}

export function planExtraction(
  extracted: ExtractedEntity[],
  index: NameIndex,
  excluded: string[],
  source: string
): ExtractionPlan {
  const plan: ExtractionPlan = { ingest: { people: [], companies: [] }, review: [] };
  const queue = (
    entity: ExtractedEntity,
    reason: ReviewItem["reason"],
    candidates: NamedEntity[]
  ) =>
    plan.review.push({
      id: crypto.randomUUID().slice(0, 8),
      ts: new Date().toISOString(),
      source,
      reason,
      entity,
      candidates: candidates.map((c) => c.slug).sort(),
    });
  for (const e of extracted) {
    if (!e.name.trim() || namesUser(e, excluded)) continue;
    const resolution = resolveEntity(e, index);
    if (resolution.kind === "review") {
      queue(e, resolution.reason, resolution.candidates);
      continue;
    }
    if (resolution.kind === "known" && isExcluded(resolution.entity, index)) continue;
    const known = resolution.kind === "known" ? resolution.entity : null;
    const input = ingestInput(e, index, known);
    plan.ingest.people?.push(...(input.people ?? []));
    plan.ingest.companies?.push(...(input.companies ?? []));
  }
  return plan;
}

export function parseExtraction(output: string): ExtractedEntity[] {
  try {
    const parsed = JSON.parse(output) as { entities?: ExtractedEntity[] };
    return Array.isArray(parsed.entities) ? parsed.entities : [];
  } catch {
    return [];
  }
}

function cursorFile(): string {
  return resolve(paths.state(), "entity-extraction.json");
}

function readCursors(): Record<string, number> {
  const file = cursorFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as Record<string, number>;
  } catch {
    return {};
  }
}

export function seenCount(sessionId: string): number {
  return readCursors()[sessionId] ?? 0;
}

export function markSeen(sessionId: string, count: number): void {
  const cursors = Object.entries({ ...readCursors(), [sessionId]: count }).slice(
    -CURSOR_KEEP
  );
  writeFileSync(
    cursorFile(),
    `${JSON.stringify(Object.fromEntries(cursors), null, 2)}\n`
  );
}

export function reviewQueueFile(): string {
  return resolve(paths.knowledge(), "_review.jsonl");
}

export function queueForReview(items: ReviewItem[]): void {
  if (items.length === 0) return;
  appendFileSync(reviewQueueFile(), items.map((i) => `${JSON.stringify(i)}\n`).join(""));
}

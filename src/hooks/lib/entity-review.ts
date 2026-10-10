/**
 * The user's answers to the extraction review queue: an accepted item is written
 * to the entity the user names (or a new one), a rejected one is dropped.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { type IngestInput, ingestEntities } from "../../tools/knowledge/ingest";
import { loadKnownEntities, loadNameIndex } from "./entity-cards";
import { ingestInput, type ReviewItem, reviewQueueFile } from "./entity-extraction";
import { indexedEntities, type NamedEntity, type NameIndex } from "./entity-names";
import { profileIngest } from "./entity-research";

export interface AcceptChoice {
  as?: string;
  name?: string;
}

export interface Accepted {
  item: ReviewItem;
  slug: string;
  created: boolean;
}

function parseItem(line: string): ReviewItem[] {
  try {
    return [JSON.parse(line) as ReviewItem];
  } catch {
    return [];
  }
}

export function pendingReviews(): ReviewItem[] {
  const file = reviewQueueFile();
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8").split("\n").filter(Boolean).flatMap(parseItem);
}

function takeFromQueue(id: string): ReviewItem | null {
  const items = pendingReviews();
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  const rest = items.filter((i) => i !== item);
  writeFileSync(reviewQueueFile(), rest.map((i) => `${JSON.stringify(i)}\n`).join(""));
  return item;
}

function chosenEntity(
  item: ReviewItem,
  slug: string | undefined,
  index: NameIndex
): NamedEntity | null {
  if (!slug) return null;
  const domain = item.entity.kind === "person" ? "People" : "Companies";
  const entity = indexedEntities(index).find(
    (e) => e.domain === domain && e.slug === slug
  );
  if (!entity) throw new Error(`no ${domain} entry with slug "${slug}"`);
  return entity;
}

export function loadEntityReviewNudge(): string {
  const count = pendingReviews().length;
  if (count === 0) return "";
  const waiting =
    count === 1 ? "1 person or company waits" : `${count} people or companies wait`;
  return [
    "## Entity Review Due",
    `👥 ${waiting} for the user's answer before the knowledge store records them — offer \`pal cli knowledge review\`.`,
  ].join("\n");
}

function acceptedInput(
  item: ReviewItem,
  choice: AcceptChoice,
  index: NameIndex
): IngestInput {
  if (!item.profile) {
    const known = chosenEntity(item, choice.as, index);
    return ingestInput(item.entity, index, known, choice.name);
  }
  const target = chosenEntity(item, choice.as ?? item.entity.existing, index);
  return profileIngest(
    { ...item, entity: { ...item.entity, existing: target?.slug ?? "" } },
    target?.title ?? choice.name ?? item.entity.name
  );
}

export function rejectReview(id: string): ReviewItem | null {
  return takeFromQueue(id);
}

/** Writes the item to `as` when given, else to a new entity named `name` or as extracted. */
export function acceptReview(id: string, choice: AcceptChoice = {}): Accepted | null {
  const queued = pendingReviews().find((i) => i.id === id);
  if (!queued) return null;
  const index = loadNameIndex(loadKnownEntities());
  const result = ingestEntities(acceptedInput(queued, choice, index), queued.source);
  takeFromQueue(id);
  const written = result.people[0] ?? result.companies[0];
  return { item: queued, slug: written.slug, created: written.created };
}

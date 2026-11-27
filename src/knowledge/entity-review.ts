/**
 * The user's answers to the extraction review queue: an accepted item is written
 * to the entity the user names (or a new one), a rejected one is dropped. An
 * answer is a line appended to the queue, so the queue only grows and two
 * machines merge it line by line.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { loadKnownEntities, loadNameIndex } from "./entity-cards";
import { ingestInput, type ReviewItem, reviewQueueFile } from "./entity-extraction";
import { indexedEntities, type NamedEntity, type NameIndex } from "./entity-names";
import { profileIngest } from "./entity-research";
import { type IngestInput, ingestEntities } from "./ingest";

export interface AcceptChoice {
  as?: string;
  name?: string;
}

export interface Accepted {
  item: ReviewItem;
  slug: string;
  created: boolean;
}

interface Answer {
  answered: string;
  outcome: "accepted" | "rejected";
  at: string;
}

type QueueLine = ReviewItem | Answer;

function parseLine(line: string): QueueLine[] {
  try {
    return [JSON.parse(line) as QueueLine];
  } catch {
    return [];
  }
}

function queueLines(): QueueLine[] {
  const file = reviewQueueFile();
  if (!existsSync(file)) return [];

  return readFileSync(file, "utf-8").split("\n").filter(Boolean).flatMap(parseLine);
}

const isAnswer = (line: QueueLine): line is Answer => "answered" in line;

export function pendingReviews(): ReviewItem[] {
  const lines = queueLines();
  const answered = new Set(lines.filter(isAnswer).map((a) => a.answered));

  return lines.filter(
    (line): line is ReviewItem => !isAnswer(line) && !answered.has(line.id)
  );
}

function takeFromQueue(id: string, outcome: Answer["outcome"]): ReviewItem | null {
  const item = pendingReviews().find((i) => i.id === id);
  if (!item) return null;
  const answer: Answer = { answered: id, outcome, at: new Date().toISOString() };
  appendFileSync(reviewQueueFile(), `${JSON.stringify(answer)}\n`);

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
  return takeFromQueue(id, "rejected");
}

/** Writes the item to `as` when given, else to a new entity named `name` or as extracted. */
export function acceptReview(id: string, choice: AcceptChoice = {}): Accepted | null {
  const queued = pendingReviews().find((i) => i.id === id);
  if (!queued) return null;
  const index = loadNameIndex(loadKnownEntities());
  const result = ingestEntities(acceptedInput(queued, choice, index), queued.source);
  takeFromQueue(id, "accepted");
  const written = result.people[0] ?? result.companies[0];

  return { item: queued, slug: written.slug, created: written.created };
}

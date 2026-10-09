/**
 * Prompt-time cards for the people and companies a prompt names, so the user
 * never has to re-explain who someone is. Reads files only; no model call.
 */

import { type Entity, list } from "../../tools/knowledge/lib";
import {
  buildNameIndex,
  entityKey,
  findMentions,
  type Mention,
  type NamedEntity,
  type NameIndex,
} from "./entity-names";
import { identity } from "./settings";

const MAX_CARDS = 3;
const MAX_LATEST = 160;

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function textField(entity: Entity, key: string): string {
  const value = entity.frontmatter[key];
  return typeof value === "string" ? value.trim() : "";
}

function namedEntity(entity: Entity): NamedEntity {
  return {
    slug: entity.slug,
    domain: entity.domain === "Companies" ? "Companies" : "People",
    title: entity.frontmatter.title,
    aliases: stringList(entity.frontmatter.aliases),
    domainName: textField(entity, "domain_name") || undefined,
  };
}

export function loadKnownEntities(rootDir?: string): Entity[] {
  return [...list("People", rootDir), ...list("Companies", rootDir)];
}

export function excludedNames(): string[] {
  const id = identity();
  return [id.principal.name, id.ai.name];
}

export function loadNameIndex(entities: Entity[]): NameIndex {
  return buildNameIndex(entities.map(namedEntity), excludedNames());
}

function isSourceLine(line: string): boolean {
  return (
    line.startsWith("### ") ||
    line.startsWith("<!--") ||
    /^(?:role|importance|mentioned_as|sentiment): /.test(line)
  );
}

/** The newest thing the store learned about this entity, in a sentence or two. */
export function latestNote(body: string): string {
  const sections = body.split(/\n(?=### )/);
  const text = (sections.at(-1) ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !isSourceLine(l))
    .join(" ")
    .replace(/\*\*/g, "");
  return text.length > MAX_LATEST ? `${text.slice(0, MAX_LATEST - 1)}…` : text;
}

function describe(entity: Entity): string {
  const fields =
    entity.domain === "People"
      ? [
          textField(entity, "position") || textField(entity, "role"),
          textField(entity, "company"),
        ]
      : [textField(entity, "industry")];
  const facts = [...fields, textField(entity, "relation")].filter(
    (f) => f && f !== "subject"
  );
  const latest = latestNote(entity.body);
  return [facts.join(", "), latest].filter(Boolean).join(". ");
}

function card(mention: Mention, bySlug: Map<string, Entity>): string {
  if (mention.entities.length > 1) {
    const names = mention.entities.map((e) => e.title).join(", ");
    return `- "${mention.said}" could be: ${names}. Ask which one if it matters.`;
  }
  const entity = bySlug.get(entityKey(mention.entities[0]));
  const summary = entity ? describe(entity) : "";
  const name = `- **${mention.entities[0].title}**`;
  return summary ? `${name}: ${summary}` : name;
}

export function entityReminder(prompt: string, entities: Entity[]): string | null {
  const mentions = findMentions(prompt, loadNameIndex(entities)).slice(0, MAX_CARDS);
  if (mentions.length === 0) return null;
  const bySlug = new Map(entities.map((e) => [entityKey(e), e]));
  return [
    "**Known people and companies in this message** (PAL knowledge store):",
    ...mentions.map((m) => card(m, bySlug)),
  ].join("\n");
}

export function getEntityReminder(prompt: string): string | null {
  return entityReminder(prompt, loadKnownEntities());
}

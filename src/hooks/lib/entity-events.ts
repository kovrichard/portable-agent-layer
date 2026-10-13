/**
 * The first time a person, company, idea or research topic enters the knowledge
 * store. The name stays in the content store; the event carries only its kind.
 */

import { type AppendOptions, appendEvent, logQuietly } from "./events";

export interface SeenEntity {
  domain: string;
  slug: string;
  entityType: string;
  name: string;
}

export const entityEventId = (entity: Pick<SeenEntity, "domain" | "slug">) =>
  `entity:${entity.domain}:${entity.slug}`;

export function logEntityFirstSeen(
  entity: SeenEntity,
  options: AppendOptions = {}
): void {
  logQuietly("entity_first_seen", () =>
    appendEvent(
      "entity_first_seen",
      { domain: entity.domain, entityType: entity.entityType },
      { id: entityEventId(entity), content: { name: entity.name }, ...options }
    )
  );
}

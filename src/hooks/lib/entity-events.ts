/**
 * The first time a person, company, idea or research topic enters the knowledge
 * store. The name stays in the content store; the event carries only its kind.
 */

import { appendEvent, logQuietly } from "./events";

export function logEntityFirstSeen(
  domain: string,
  entityType: string,
  name: string
): void {
  logQuietly("entity_first_seen", () =>
    appendEvent("entity_first_seen", { domain, entityType }, { content: { name } })
  );
}

/**
 * The outcomes a page groups by. Kept apart from view.ts because the browser
 * needs this list and nothing else from that module — importing it there would
 * drag the actor and machine registries, and node:fs behind them, into the
 * page bundle.
 */

export const PAGE_OUTCOMES = ["applied", "failed", "denied", "blocked"] as const;
export type PageOutcome = (typeof PAGE_OUTCOMES)[number];

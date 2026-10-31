/**
 * What the progress tree should tidy: nodes whose PRs have all merged but that were
 * never finished, and existing nodes a new title repeats, so the topic is entered
 * again instead of opened twice.
 */

import type { ScopeTree, SettledPr, WorkNode } from "./progress-tree";

const RECENTLY_FINISHED_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_SHARED_WORDS = 2;
const MIN_SHARED_SHARE = 0.5;
const FILLER_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "into",
  "from",
  "its",
  "not",
  "this",
  "that",
  "are",
  "was",
  "one",
]);

export interface MergedNode {
  node: WorkNode;
  lastMerge: SettledPr;
}

function prRefs(node: WorkNode): Set<string> {
  return new Set(node.artifacts.filter((a) => a.kind === "pr").map((a) => a.ref));
}

function lastMergeOf(node: WorkNode): SettledPr | null {
  const refs = prRefs(node);
  if (refs.size === 0) return null;
  const merged = node.settledPrs.filter((pr) => pr.state === "merged");
  if (!merged.length || [...refs].some((ref) => !merged.some((pr) => pr.ref === ref)))
    return null;
  return merged.reduce((a, b) => (Date.parse(b.at) > Date.parse(a.at) ? b : a));
}

function untouchedSince(node: WorkNode, merge: SettledPr): boolean {
  return Date.parse(node.updated) <= Date.parse(merge.at);
}

/** Open nodes whose every PR merged and that nothing was recorded on afterwards. */
export function mergedButOpen(tree: ScopeTree): MergedNode[] {
  return [...tree.nodes.values()].flatMap((node) => {
    if (node.status === "done") return [];
    const lastMerge = lastMergeOf(node);
    return lastMerge && untouchedSince(node, lastMerge) ? [{ node, lastMerge }] : [];
  });
}

function significantWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !FILLER_WORDS.has(word))
  );
}

type Rarity = (word: string) => number;

/** A word most titles in the scope use ("tree", "factory") says little about which topic a title is. */
function rarityAmong(titles: string[]): Rarity {
  const uses = new Map<string, number>();
  for (const title of titles)
    for (const word of significantWords(title)) uses.set(word, (uses.get(word) ?? 0) + 1);
  return (word) => Math.log(1 + titles.length / (uses.get(word) ?? 1));
}

function repeats(a: Set<string>, b: Set<string>, rarity: Rarity): boolean {
  const shared = [...a].filter((word) => b.has(word));
  if (shared.length < MIN_SHARED_WORDS) return false;
  const weight = (words: Iterable<string>) =>
    [...words].reduce((sum, word) => sum + rarity(word), 0);
  return weight(shared) / Math.min(weight(a), weight(b)) >= MIN_SHARED_SHARE;
}

function stillRelevant(node: WorkNode, now: Date): boolean {
  return (
    node.status !== "done" ||
    now.getTime() - Date.parse(node.updated) <= RECENTLY_FINISHED_MS
  );
}

export function recentlyFinished(tree: ScopeTree, now: Date = new Date()): WorkNode[] {
  return [...tree.nodes.values()]
    .filter((node) => node.status === "done" && stillRelevant(node, now))
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

/** Open nodes, and nodes finished in the last 30 days, whose title shares most of its rarer words with this one. */
export function similarNodes(
  tree: ScopeTree,
  title: string,
  now: Date = new Date()
): WorkNode[] {
  const nodes = [...tree.nodes.values()];
  const rarity = rarityAmong(nodes.map((node) => node.title));
  const words = significantWords(title);
  return nodes.filter(
    (node) =>
      stillRelevant(node, now) && repeats(words, significantWords(node.title), rarity)
  );
}

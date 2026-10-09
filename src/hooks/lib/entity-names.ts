/**
 * Which known people and companies a text mentions. A lookup against the names
 * already in the knowledge store, never a guess at what a name looks like.
 */

export interface NamedEntity {
  slug: string;
  domain: "People" | "Companies";
  title: string;
  aliases: string[];
  domainName?: string;
}

interface Term {
  tokens: string[];
  entity: NamedEntity;
  partial: boolean;
}

export interface NameIndex {
  terms: Term[];
  excluded: Set<string>;
}

export interface Mention {
  said: string;
  entities: NamedEntity[];
}

interface Token {
  raw: string;
  folded: string;
  gapBefore: string;
}

const NON_PROSE = [
  /```[\s\S]*?```/g,
  /`[^`\n]*`/g,
  /\bhttps?:\/\/\S+/g,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /[\w.-]+(?:\/[\w.-]+)+/g,
  /<[^>\n]*>/g,
];

const LEGAL_SUFFIX =
  /\s+(?:kft|nyrt|zrt|bt|kkt|ltd|inc|llc|gmbh|korlatolt felelossegu tarsasag)\.?$/;
const WORD = /[\p{L}\p{N}](?:[\p{L}\p{N}'’.-]*[\p{L}\p{N}])?/gu;
const SENTENCE_BREAK = /[.!?:;\n]/;
const MIN_PARTIAL = 3;

export function foldName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]s$/, "")
    .replace(/[.,]+$/, "")
    .trim();
}

export function proseOnly(text: string): string {
  return NON_PROSE.reduce((out, re) => out.replace(re, " "), text);
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD)) {
    const start = m.index ?? 0;
    tokens.push({
      raw: m[0],
      folded: foldName(m[0]),
      gapBefore: text.slice(last, start),
    });
    last = start + m[0].length;
  }
  return tokens;
}

function words(name: string): string[] {
  return tokenize(name).map((t) => t.folded);
}

function companyNames(entity: NamedEntity): string[] {
  const bare = foldName(entity.title).replace(LEGAL_SUFFIX, "");
  const site = entity.domainName ? foldName(entity.domainName).split(".")[0] : "";
  return [entity.title, bare, site, ...entity.aliases];
}

function personNames(entity: NamedEntity): string[] {
  const parts = words(entity.title);
  const reversed = parts.length === 2 ? `${parts[1]} ${parts[0]}` : "";
  return [entity.title, reversed, ...entity.aliases];
}

function fullTerms(entity: NamedEntity): Term[] {
  const names = entity.domain === "People" ? personNames(entity) : companyNames(entity);
  return names
    .map(words)
    .filter((tokens) => tokens.join(" ").length >= 2)
    .map((tokens) => ({ tokens, entity, partial: false }));
}

function partialTerms(entity: NamedEntity): Term[] {
  if (entity.domain !== "People") return [];
  const parts = words(entity.title);
  if (parts.length < 2) return [];
  return parts
    .filter((p) => p.length >= MIN_PARTIAL)
    .map((p) => ({ tokens: [p], entity, partial: true }));
}

/** Names in `excludedNames` (the user, the assistant) are indexed so they consume
 *  their words, but never reported. */
export function buildNameIndex(
  entities: NamedEntity[],
  excludedNames: string[]
): NameIndex {
  const excludedFolded = new Set(excludedNames.filter(Boolean).map(foldName));
  const excluded = new Set(
    entities
      .filter((e) => fullTerms(e).some((t) => excludedFolded.has(t.tokens.join(" "))))
      .map(entityKey)
  );
  const terms = entities.flatMap((e) => [...fullTerms(e), ...partialTerms(e)]);
  terms.sort(
    (a, b) => Number(a.partial) - Number(b.partial) || b.tokens.length - a.tokens.length
  );
  return { terms, excluded };
}

function matchesAt(tokens: Token[], at: number, term: Term): boolean {
  return term.tokens.every((w, i) => tokens[at + i]?.folded === w);
}

function isCapitalized(token: Token | undefined): boolean {
  return Boolean(token && /^\p{Lu}/u.test(token.raw));
}

function joinedTo(token: Token | undefined): boolean {
  return Boolean(
    token && /^\s+$/.test(token.gapBefore) && !SENTENCE_BREAK.test(token.gapBefore)
  );
}

function startsSentence(tokens: Token[], at: number): boolean {
  return at === 0 || SENTENCE_BREAK.test(tokens[at].gapBefore);
}

/** "Daniel Miessler" is not a known Dániel: a lone given name next to an unknown
 *  capitalised word belongs to someone else. */
function besideUnknownName(tokens: Token[], at: number): boolean {
  const next = tokens[at + 1];
  if (joinedTo(next) && isCapitalized(next)) return true;
  const prev = tokens[at - 1];
  return joinedTo(tokens[at]) && isCapitalized(prev) && !startsSentence(tokens, at - 1);
}

function isLoneWordOfPerson(term: Term): boolean {
  return term.entity.domain === "People" && term.tokens.length === 1;
}

function termsAt(index: NameIndex, tokens: Token[], at: number): Term[] {
  const first = index.terms.find((t) => matchesAt(tokens, at, t));
  if (!first) return [];
  if (isLoneWordOfPerson(first) && besideUnknownName(tokens, at)) return [];
  return index.terms.filter(
    (t) =>
      t.partial === first.partial &&
      t.tokens.length === first.tokens.length &&
      matchesAt(tokens, at, t)
  );
}

function addMention(
  found: Map<string, Mention>,
  said: string,
  terms: Term[],
  index: NameIndex
) {
  const entities = distinctEntities(terms);
  if (entities.some((e) => isExcluded(e, index))) return;
  const key = entities.map(entityKey).sort().join("|");
  if (!found.has(key)) found.set(key, { said, entities });
}

export function findMentions(text: string, index: NameIndex): Mention[] {
  const tokens = tokenize(proseOnly(text));
  const found = new Map<string, Mention>();
  let at = 0;
  while (at < tokens.length) {
    const terms = termsAt(index, tokens, at);
    const width = terms[0]?.tokens.length ?? 1;
    if (terms.length > 0) {
      const said = tokens
        .slice(at, at + width)
        .map((t) => t.raw)
        .join(" ");
      addMention(found, said, terms, index);
    }
    at += width;
  }
  return [...found.values()];
}

/** The entities a name could mean; `exact` when it is someone's full name or alias
 *  rather than one word of a longer name. */
export function lookupName(
  name: string,
  index: NameIndex
): { entities: NamedEntity[]; exact: boolean } {
  const folded = words(name).join(" ");
  const named = (t: Term) => t.tokens.join(" ") === folded;
  const full = index.terms.filter((t) => !t.partial && named(t));
  if (full.length > 0) return { entities: distinctEntities(full), exact: true };
  return { entities: distinctEntities(index.terms.filter(named)), exact: false };
}

export function indexedEntities(index: NameIndex): NamedEntity[] {
  return distinctEntities(index.terms);
}

export function isExcluded(entity: NamedEntity, index: NameIndex): boolean {
  return index.excluded.has(entityKey(entity));
}

export function entityKey(entity: { domain: string; slug: string }): string {
  return `${entity.domain}/${entity.slug}`;
}

function distinctEntities(terms: Term[]): NamedEntity[] {
  return [...new Map(terms.map((t) => [entityKey(t.entity), t.entity])).values()];
}

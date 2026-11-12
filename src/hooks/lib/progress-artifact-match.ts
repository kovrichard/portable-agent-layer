type ArtifactRef = { kind: string; ref: string };

const PR_URL_RE = /^https?:\/\//;
const SHORT_SHA_LENGTH = 7;

function prNumberOf(ref: string): string | null {
  return /(\d+)$/.exec(ref)?.[1] ?? null;
}

function samePr(a: string, b: string): boolean {
  if (PR_URL_RE.test(a) && PR_URL_RE.test(b)) return a === b;
  const number = prNumberOf(a);

  return number !== null && number === prNumberOf(b);
}

function sameCommit(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];

  return short.length >= SHORT_SHA_LENGTH && long.startsWith(short);
}

export function sameArtifact(a: ArtifactRef, b: ArtifactRef): boolean {
  if (a.kind !== b.kind) return false;

  if (a.kind === "pr") return samePr(a.ref, b.ref);

  if (a.kind === "commit") return sameCommit(a.ref, b.ref);

  return a.ref === b.ref;
}

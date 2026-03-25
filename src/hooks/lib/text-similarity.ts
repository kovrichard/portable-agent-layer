/**
 * Text similarity using Dice coefficient on keyword sets.
 *
 * Dice is more generous than Jaccard for short, variable-length texts
 * (like chatbot messages and failure contexts) because it divides by
 * average set size instead of union:
 *
 *   Dice = 2 * |intersection| / (|A| + |B|)
 */

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "shall",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "and",
  "but",
  "or",
  "nor",
  "not",
  "no",
  "so",
  "if",
  "then",
  "than",
  "that",
  "this",
  "it",
  "its",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "what",
  "which",
  "who",
  "when",
  "where",
  "how",
  "all",
  "each",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "up",
  "out",
  "about",
  "just",
  "also",
  "very",
  "too",
  "only",
  "own",
]);

/** Strip common English suffixes to normalize word forms. Applied twice to handle stacked suffixes. */
function stemOnce(word: string): string {
  if (word.length <= 4) return word;
  return word
    .replace(/(?<=.{4})tion$/, "")
    .replace(/(?<=.{4})sion$/, "")
    .replace(/(?<=.{4})ment$/, "")
    .replace(/(?<=.{3})ness$/, "")
    .replace(/(?<=.{3})ings$/, "")
    .replace(/(?<=.{3})ing$/, "")
    .replace(/(?<=.{3})ies$/, "y")
    .replace(/(?<=.{3})ive$/, "")
    .replace(/(?<=.{3})ous$/, "")
    .replace(/(?<=.{3})ful$/, "")
    .replace(/(?<=.{3})ally$/, "")
    .replace(/(?<=.{3})ly$/, "")
    .replace(/(?<=.{3})ed$/, "")
    .replace(/(?<=.{3})er$/, "")
    .replace(/(?<=.{3})es$/, "")
    .replace(/(?<=.{3})s$/, "");
}

function stem(word: string): string {
  return stemOnce(stemOnce(word));
}

export function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
      .map((w) => stem(w))
      .filter((w) => w.length > 2)
  );
}

/** Dice coefficient on keyword sets. Returns 0-1. */
export function similarity(a: string, b: string): number {
  const ka = extractKeywords(a);
  const kb = extractKeywords(b);
  if (ka.size === 0 || kb.size === 0) return 0;

  let intersection = 0;
  for (const w of ka) {
    if (kb.has(w)) intersection++;
  }

  return (2 * intersection) / (ka.size + kb.size);
}

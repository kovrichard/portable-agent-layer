/**
 * Cheap facts about a prompt and a reply, measured in code: no inference, no text kept.
 */

const STOPWORDS: Record<string, readonly string[]> = {
  en: [
    "the",
    "and",
    "is",
    "to",
    "of",
    "it",
    "that",
    "this",
    "with",
    "for",
    "you",
    "what",
  ],
  hu: ["és", "hogy", "nem", "egy", "az", "de", "meg", "van", "is", "mit", "ez", "csak"],
};

const MIN_STOPWORD_HITS = 2;
const PASTED_RE = /<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/gi;
const IMAGE_RE = /\[Image #\d+\]/g;
const COMMAND_TAG_RE = /<command-name>\s*\/?([\w:-]+)\s*<\/command-name>/;
const SLASH_RE = /^\/([\w:-]+)(?:\s|$)/;
const MODE_RE = /═+\s*PAL(?:\s*\|\s*([A-Z]+))?\s*═+/;

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
}

export function languageOf(text: string): string | null {
  const words = new Set(tokens(text));
  let best: string | null = null;
  let bestHits = MIN_STOPWORD_HITS - 1;
  for (const [language, stopwords] of Object.entries(STOPWORDS)) {
    const hits = stopwords.filter((w) => words.has(w)).length;
    if (hits > bestHits) {
      best = language;
      bestHits = hits;
    }
  }
  return best;
}

export function pastedChars(prompt: string): number {
  return Array.from(prompt.matchAll(PASTED_RE), (m) => m[1]?.length ?? 0).reduce(
    (a, b) => a + b,
    0
  );
}

export function imageCount(prompt: string): number {
  return prompt.match(IMAGE_RE)?.length ?? 0;
}

export function slashCommandOf(prompt: string): string | null {
  const tagged = COMMAND_TAG_RE.exec(prompt)?.[1];
  if (tagged) return tagged;
  return SLASH_RE.exec(prompt.trim())?.[1] ?? null;
}

export function turnExtras(prompt: string, text: string) {
  return {
    language: languageOf(text),
    pastedChars: pastedChars(prompt),
    images: imageCount(prompt),
    command: slashCommandOf(prompt),
  };
}

export function responseModeOf(reply: string): string | null {
  const match = MODE_RE.exec(reply.slice(0, 400));
  if (!match) return null;
  return match[1] ?? "MINIMAL";
}

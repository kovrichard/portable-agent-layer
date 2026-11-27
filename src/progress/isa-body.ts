/** The `## Heading` sections of an ISA.md body. */

export interface IsaSections {
  problem?: string;
  goal?: string;
  criteria?: string;
  vision?: string;
  constraints?: string;
  out_of_scope?: string;
  context?: string;
  decisions?: string;
  changelog?: string;
}

const BODY_SECTIONS: Array<[string, keyof IsaSections]> = [
  ["Problem", "problem"],
  ["Goal", "goal"],
  ["Criteria", "criteria"],
  ["Vision", "vision"],
  ["Constraints", "constraints"],
  ["Out of Scope", "out_of_scope"],
  ["Context", "context"],
  ["Decisions", "decisions"],
  ["Changelog", "changelog"],
];

const HEADER_TO_FIELD: Record<string, keyof IsaSections> = Object.fromEntries(
  BODY_SECTIONS.map(([h, k]) => [h.toLowerCase(), k])
);

export function buildBody(sections: IsaSections): string {
  return BODY_SECTIONS.filter(([, k]) => sections[k]?.trim())
    .map(([h, k]) => `## ${h}\n\n${(sections[k] as string).trim()}`)
    .join("\n\n");
}

export function extractSections(body: string): IsaSections {
  const out: IsaSections = {};

  for (const part of body.split(/^## /m).slice(1)) {
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const header = part.slice(0, nl).trim().toLowerCase();
    const content = part.slice(nl + 1).trim();
    if (!content) continue;
    const field = HEADER_TO_FIELD[header];
    if (field) out[field] = content;
  }

  return out;
}

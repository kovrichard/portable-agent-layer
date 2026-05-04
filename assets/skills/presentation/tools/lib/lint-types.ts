// presentation skill — types shared across the lint pipeline.
//
// The doctor is structured as a rule registry: each rule is a small object
// with a `check` function that emits Findings. Rules are either slide-scoped
// (run once per slide) or deck-scoped (run once across the whole deck).

export type Severity = "E" | "W";
export type Finding = { rule: string; severity: Severity; msg: string };
export type SlideReport = { name: string; layout: string; findings: Finding[] };

export type SlideContext = {
  name: string;
  body: string; // raw markdown, includes Note: section
  bodyNoNotes: string; // body with the Note: section stripped
  layout: string;
  deckDir: string;
  heads1: string[];
  heads2: string[];
  index: number; // 0-based position in the deck
};

export type DeckContext = {
  deckDir: string;
  slides: SlideContext[];
};

export type SlideRule = {
  name: string;
  scope: "slide";
  appliesTo?: (ctx: SlideContext) => boolean;
  check: (ctx: SlideContext) => Promise<Finding[]> | Finding[];
};

export type DeckRule = {
  name: string;
  scope: "deck";
  check: (ctx: DeckContext) => Promise<Finding[]> | Finding[];
};

export type Rule = SlideRule | DeckRule;

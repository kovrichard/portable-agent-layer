/**
 * Contextual Steering — deterministic prompt-type classifier that injects
 * task-specific steering into the model's context at prompt time.
 *
 * Pure + fail-open: classifyPrompt is a regex table (no LLM, sub-millisecond).
 * getSteeringReminder wraps matched snippets in a single <system-reminder>,
 * byte-capped. It rides the same UserPromptSubmit path as inject-retrieval; the
 * per-agent output adapter is shared (see inject-retrieval's writeForAgent).
 *
 * This is the prompt-time counterpart to STEERING_RULES.md: the always-on file
 * keeps terse directives, while the verbose guidance lives here and is injected
 * only when the prompt matches that task type.
 */

import { isEnabled, raw } from "./settings";

/** The tags shipped as built-in defaults. Users may add their own tags via
 *  pal-settings.json `steering.rules`, so the effective tag set is open-ended. */
type SteeringTag =
  | "debugging"
  | "destructive"
  | "refactor"
  | "planning"
  | "testing"
  | "committing"
  | "secrets";

interface SteeringRule {
  tag: string;
  pattern: RegExp;
  snippet: string;
}

// Ordered rule table. Multiple rules may match one prompt; classifyPrompt
// returns every match in declaration order. Patterns are anchored on word
// boundaries to avoid substring false-positives (e.g. "warm" ≠ "rm").
const STEERING_RULES: Array<SteeringRule & { tag: SteeringTag }> = [
  {
    tag: "debugging",
    pattern:
      /\b(bugs?|broken|failing|fails?|errors?|crash\w*|regress\w*|debug\w*|not working|doesn'?t work|stack ?trace)\b/i,
    snippet:
      "Debugging something? If so, change one thing at a time and reproduce the failure before fixing — keep the correction surgical rather than a rewrite.",
  },
  {
    tag: "destructive",
    pattern:
      /\b(delete|remove|drop|rm\s+-rf|force[- ]push|reset\s+--hard|wipe|truncate|prune)\b/i,
    snippet:
      "About to delete, force-push, or drop something irreversible? If so, list what's affected and confirm before acting — and if what you find contradicts how it was described, surface that first.",
  },
  {
    tag: "refactor",
    pattern:
      /\b(refactor\w*|clean\s?up|simplif\w*|reorganiz\w*|restructur\w*|dead code|tech debt)\b/i,
    snippet:
      "Refactoring or cleaning up? If so, prefer first-principles simplification over adding new layers, and keep the change scoped to what was asked — flag dead code rather than silently rewriting neighboring files.",
  },
  {
    tag: "planning",
    pattern: /\b(plans?|planning|designs?|designing|architect\w*|roadmap)\b/i,
    snippet:
      "Planning or designing something? If you were asked to plan, present the approach and stop — wait for an explicit go-ahead before writing any code.",
  },
  {
    tag: "testing",
    pattern: /\b(tests?|testing|coverage|assertions?|vacuous)\b/i,
    snippet:
      "Adding or changing a test? Prove it isn't vacuous — make it fail first for the right reason, then restore it, so a green run actually means something.",
  },
  {
    tag: "committing",
    pattern: /\b(commits?|committing|pull requests?|cherry-pick|rebase|PR)\b|git push/i,
    snippet:
      "About to commit, push, or open a PR? Only do it if it was asked, and keep the commit scoped to exactly what was requested.",
  },
  {
    tag: "secrets",
    pattern: /\b(secrets?|api[\s-]?keys?|tokens?|passwords?|credentials?)\b|\.env\b/i,
    snippet:
      "Handling secrets, API keys, or credentials? Never hardcode them in source or commit them — keep them in env or private config, and never echo them into logs or output.",
  },
];

const MAX_STEERING_BYTES = 1000;

/** Merge shipped defaults with the user's pal-settings.json extension:
 *  `steering.disable` removes built-ins by tag; `steering.rules` appends personal
 *  rules. Malformed user entries (missing field or bad regex) are skipped, never
 *  thrown — a broken personal rule must not disable steering for everyone. */
function effectiveRules(): SteeringRule[] {
  const cfg = raw().steering ?? {};
  const disabled = new Set(cfg.disable ?? []);
  const rules: SteeringRule[] = STEERING_RULES.filter((r) => !disabled.has(r.tag));
  for (const u of cfg.rules ?? []) {
    if (!u?.tag || !u?.pattern || !u?.snippet) continue;
    let pattern: RegExp;
    try {
      pattern = new RegExp(u.pattern, "i");
    } catch {
      continue; // fail-open: skip malformed regex
    }
    rules.push({ tag: u.tag, pattern, snippet: u.snippet });
  }
  return rules;
}

/** Match a prompt against the effective rule set, one hit per tag, in order. */
function matchRules(text: string): SteeringRule[] {
  if (!text?.trim()) return [];
  const matched: SteeringRule[] = [];
  const seen = new Set<string>();
  for (const rule of effectiveRules()) {
    if (!seen.has(rule.tag) && rule.pattern.test(text)) {
      seen.add(rule.tag);
      matched.push(rule);
    }
  }
  return matched;
}

/** Deterministically classify a prompt into steering tags. Pure, fail-open. */
export function classifyPrompt(text: string): string[] {
  return matchRules(text).map((r) => r.tag);
}

/** Build the steering <system-reminder> for a prompt, or null if nothing matches. */
export function getSteeringReminder(prompt: string): string | null {
  if (!isEnabled("contextualSteering")) return null;

  let matched: SteeringRule[];
  try {
    matched = matchRules(prompt);
  } catch {
    return null; // fail-open: never block a prompt on a classifier error
  }
  if (matched.length === 0) return null;

  const lines: string[] = [];
  let budget = MAX_STEERING_BYTES;
  for (const rule of matched) {
    const line = `- ${rule.snippet}`;
    const cost = Buffer.byteLength(line);
    if (cost > budget) break; // byte-cap: drop the overflow tail, keep top matches
    lines.push(line);
    budget -= cost;
  }
  if (lines.length === 0) return null;

  const inner = [
    "Heuristic self-checks auto-matched on your prompt — they may be off; ignore any that don't apply:",
    ...lines,
  ];
  // Dual-live test period: co-locate the report instruction with the trigger so
  // it fires reliably across sessions/compaction. Flip steeringTestReport off to end it.
  if (isEnabled("steeringTestReport")) {
    inner.push(
      "— Test period: assistant, briefly note to the user that a steering self-check fired, and which one(s)."
    );
  }
  return ["<system-reminder>", ...inner, "</system-reminder>"].join("\n");
}

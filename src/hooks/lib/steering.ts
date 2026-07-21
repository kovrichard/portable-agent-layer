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

import { isEnabled } from "./settings";

export type SteeringTag =
  | "debugging"
  | "destructive"
  | "refactor"
  | "planning"
  | "testing"
  | "committing"
  | "secrets";

interface SteeringRule {
  tag: SteeringTag;
  pattern: RegExp;
  snippet: string;
}

// Ordered rule table. Multiple rules may match one prompt; classifyPrompt
// returns every match in declaration order. Patterns are anchored on word
// boundaries to avoid substring false-positives (e.g. "warm" ≠ "rm").
const STEERING_RULES: SteeringRule[] = [
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
      "About to commit, push, or open a PR? Only if it was asked — and if you're on the default branch, branch first; keep the commit scoped to what was requested.",
  },
  {
    tag: "secrets",
    pattern: /\b(secrets?|api[\s-]?keys?|tokens?|passwords?|credentials?)\b|\.env\b/i,
    snippet:
      "Handling secrets, API keys, or credentials? Never hardcode them in source or commit them — keep them in env or private config, and never echo them into logs or output.",
  },
];

const MAX_STEERING_BYTES = 1000;

/** Deterministically classify a prompt into steering tags. Pure, fail-open. */
export function classifyPrompt(text: string): SteeringTag[] {
  if (!text?.trim()) return [];
  const tags: SteeringTag[] = [];
  for (const rule of STEERING_RULES) {
    if (rule.pattern.test(text)) tags.push(rule.tag);
  }
  return tags;
}

/** Build the steering <system-reminder> for a prompt, or null if nothing matches. */
export function getSteeringReminder(prompt: string): string | null {
  if (!isEnabled("contextualSteering")) return null;

  let tags: SteeringTag[];
  try {
    tags = classifyPrompt(prompt);
  } catch {
    return null; // fail-open: never block a prompt on a classifier error
  }
  if (tags.length === 0) return null;

  const snippetByTag = new Map(STEERING_RULES.map((r) => [r.tag, r.snippet]));
  const lines: string[] = [];
  let budget = MAX_STEERING_BYTES;
  for (const tag of tags) {
    const snippet = snippetByTag.get(tag);
    if (!snippet) continue;
    const line = `- ${snippet}`;
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

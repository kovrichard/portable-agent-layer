/**
 * Stop handler: detects preferences and anti-patterns in the session transcript
 * and appends them to domain-specific wisdom frame files.
 */

import type { Message } from "../lib/transcript";
import { extractContent, parseMessages } from "../lib/transcript";
import type { ObservationType } from "../lib/wisdom";
import { updateFrame } from "../lib/wisdom";

interface Detection {
  domain: string;
  observation: string;
  type: ObservationType;
}

const PRINCIPLE_RE = /\b(always|make sure|remember to|important to|should always)\b/i;
const ANTI_PATTERN_RE = /\b(don't|do not|never|avoid|stop)\s.{5,60}(?:[.!]|$)/i;
const PREFERENCE_RE = /\b(prefer|like to|want|appreciate|hate|dislike)\b/i;

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  coding: [
    "code",
    "function",
    "variable",
    "class",
    "method",
    "typescript",
    "javascript",
    "python",
    "test",
    "lint",
    "format",
    "refactor",
    "import",
  ],
  git: ["commit", "branch", "merge", "push", "pull", "pr", "pull request", "rebase"],
  communication: [
    "explain",
    "respond",
    "answer",
    "tone",
    "verbose",
    "concise",
    "summary",
    "message",
    "write",
  ],
  tools: ["tool", "editor", "terminal", "claude", "hook", "script", "plugin"],
  workflow: ["workflow", "task", "session", "setup", "install", "process", "step"],
};

function detectDomain(text: string): string {
  const lower = text.toLowerCase();
  let best = "general";
  let bestCount = 0;

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    const count = keywords.filter((k) => lower.includes(k)).length;
    if (count > bestCount) {
      bestCount = count;
      best = domain;
    }
  }

  return best;
}

function extractDetections(messages: Message[]): Detection[] {
  const results: Detection[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    const text = extractContent(msg);
    if (!text) continue;

    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim();
      if (s.length < 15 || s.length > 200) continue;

      let type: ObservationType | null = null;

      if (PRINCIPLE_RE.test(s)) {
        type = "principle";
      } else if (ANTI_PATTERN_RE.test(s)) {
        type = "anti-pattern";
      } else if (PREFERENCE_RE.test(s) && msg.role === "user") {
        type = "rule";
      }

      if (!type) continue;

      const key = s.slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        domain: detectDomain(s),
        observation: s.slice(0, 150),
        type,
      });

      if (results.length >= 5) return results;
    }
  }

  return results;
}

export async function captureWisdom(transcript: string): Promise<void> {
  const messages = parseMessages(transcript);
  if (messages.length < 2) return;

  for (const { domain, observation, type } of extractDetections(messages)) {
    updateFrame(domain, observation, type);
  }
}

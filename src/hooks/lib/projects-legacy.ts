import type { ProjectProgress, ProjectStatus } from "./projects";

interface LegacyDecision {
  ts: string;
  decision: string;
  rationale: string;
}

interface LegacyProject {
  name: string;
  path: string;
  status: ProjectStatus;
  created: string;
  updated: string;
  facts?: string[];
  objectives?: string[];
  next_steps?: string[];
  blockers?: string[];
  decisions?: LegacyDecision[];
}

/**
 * Convert a parsed legacy progress JSON object into the current ProjectProgress
 * shape. Returns null if required fields (name/path/status) are missing.
 */
export function legacyJsonToProgress(raw: unknown): ProjectProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as LegacyProject;
  if (!r.name || !r.path || !r.status) return null;
  const p: ProjectProgress = {
    name: r.name,
    path: r.path,
    status: r.status,
    created: r.created ?? new Date().toISOString(),
    updated: r.updated ?? new Date().toISOString(),
    ...(r.next_steps?.length ? { next: r.next_steps } : {}),
    ...(r.blockers?.length ? { blockers: r.blockers } : {}),
  };

  if (r.facts?.length) p.context = r.facts.join("\n");

  if (r.objectives?.length) p.goal = r.objectives.map((o) => `- ${o}`).join("\n");

  if (r.decisions?.length) {
    p.decisions = r.decisions
      .map((d) => `- ${d.ts.slice(0, 10)}: ${d.decision} (${d.rationale})`)
      .join("\n");
  }

  return p;
}

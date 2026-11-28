import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { palHome, palPkg } from "../../core/paths";
import { settingsPath } from "../../core/settings";
import { telosStatus } from "../../opinions/telos-topics";
import { auditBindings, type BindingIssue } from "../../progress/binding-audit";
import { bindingDrift, hasBindingHistory } from "../../progress/binding-history";
import type { BindingChange } from "../../progress/bindings";
import { quarantineCount } from "../../sync/status";
import {
  type LegacyOpinions,
  opinionCount,
  readLegacyOpinions,
} from "../legacy-opinions";
import { retiredKeysIn } from "../migrations/v7-retired-settings-keys";
import { type Finding, failing, optional, passed, warning } from "./finding";

export interface SchemaNode {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  description?: string;
  default?: unknown;
  examples?: unknown[];
  properties?: Record<string, SchemaNode>;
  additionalProperties?: boolean | SchemaNode;
  items?: SchemaNode;
}

interface UnknownKey {
  path: string;
  suggestion?: string;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }

  return row[b.length];
}

function closest(key: string, candidates: string[]): string | undefined {
  const ranked = candidates
    .map((candidate) => ({ candidate, distance: editDistance(key, candidate) }))
    .sort((x, y) => x.distance - y.distance);
  const best = ranked[0];

  return best && best.distance <= 2 ? best.candidate : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function unknownSettingsKeys(
  value: unknown,
  schema: SchemaNode,
  path = ""
): UnknownKey[] {
  if (Array.isArray(value) && schema.items) {
    const items = schema.items;

    return value.flatMap((item, i) => unknownSettingsKeys(item, items, `${path}[${i}]`));
  }

  if (!isPlainObject(value)) return [];
  const declared = schema.properties ?? {};
  const closed = schema.properties !== undefined && schema.additionalProperties !== true;

  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    const childSchema = declared[key];
    if (childSchema) return unknownSettingsKeys(child, childSchema, childPath);

    if (!closed) return [];

    return [{ path: childPath, suggestion: closest(key, Object.keys(declared)) }];
  });
}

export function readSettingsSchema(): SchemaNode | null {
  try {
    return JSON.parse(
      readFileSync(resolve(palPkg(), "assets", "schema", "settings.schema.json"), "utf-8")
    );
  } catch {
    return null;
  }
}

function identityFinding(settings: Record<string, unknown>): Finding {
  const identity = settings.identity as
    | { principal?: { name?: string }; ai?: { name?: string } }
    | undefined;
  if (identity?.principal?.name && identity?.ai?.name)
    return passed("identity", "Identity configured");

  return warning("identity", "Identity is incomplete — PAL does not know both names", {
    say: "Answer the identity questions",
    command: "pal cli install",
    external: false,
  });
}

function describeUnknownKey(key: UnknownKey): string {
  return key.suggestion ? `${key.path} (did you mean ${key.suggestion}?)` : key.path;
}

function unknownKeysFinding(keys: UnknownKey[]): Finding {
  if (keys.length === 0)
    return passed("settings.unknown", "Every setting is one PAL reads");
  const noun = keys.length === 1 ? "a setting" : `${keys.length} settings`;

  return warning(
    "settings.unknown",
    `The settings file has ${noun} PAL ignores: ${keys.map(describeUnknownKey).join(", ")}`,
    { say: `Rename or remove them in ${settingsPath()}` }
  );
}

function settingsFindings(): Finding[] {
  const path = settingsPath();
  if (!existsSync(path))
    return [
      warning("settings.missing", `The settings file is missing (${path})`, {
        say: "Recreate it",
        command: "pal cli install",
        external: false,
      }),
    ];
  let settings: unknown;

  try {
    settings = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    return [
      failing(
        "settings.unreadable",
        `The settings file is not valid JSON: ${(error as Error).message}`,
        {
          say: `Fix the JSON in ${path} — PAL is running on defaults until then`,
        }
      ),
    ];
  }

  if (!isPlainObject(settings))
    return [
      failing("settings.unreadable", "The settings file is not a JSON object", {
        say: `Fix ${path}`,
      }),
    ];
  const schema = readSettingsSchema();
  const leftToMigration = new Set(
    retiredKeysIn(settings as Record<string, Record<string, unknown>>)
  );
  const unknown = schema
    ? unknownSettingsKeys(settings, schema).filter((k) => !leftToMigration.has(k.path))
    : [];

  return [identityFinding(settings), unknownKeysFinding(unknown)];
}

function telosFindings(home: string): Finding[] {
  const files = (() => {
    try {
      return readdirSync(resolve(home, "telos")).filter((f) => f.endsWith(".md")).length;
    } catch {
      return 0;
    }
  })();
  if (files === 0)
    return [
      failing("telos.missing", "TELOS is not scaffolded", {
        say: "Scaffold it",
        command: "pal cli init",
        external: false,
      }),
    ];
  const unanswered = telosStatus(home)
    .filter((topic) => topic.priority && !topic.answered)
    .map((topic) => topic.key);

  return [
    passed("telos", `TELOS: ${files} files`),
    unanswered.length === 0
      ? passed("telos.answered", "TELOS answered")
      : optional(
          "telos.unanswered",
          `TELOS ${unanswered.join(", ")} — lets PAL steer by your goals`,
          { say: "ask your agent to onboard you" }
        ),
  ];
}

type BindingProblem = { project: string; title: string; say: string; command: string };

const pointAtCheckout = (project: string) => ({
  say: "Point it at its checkout",
  command: `pal cli project set-path ${project} <path>`,
});

/** A renamed project takes the orphan's folder first; the next run then offers to drop the orphan. */
function orphanProblem(issue: Extract<BindingIssue, { kind: "orphan" }>): BindingProblem {
  const { project, path, renamedTo } = issue;
  if (renamedTo)
    return {
      project,
      title: `Binding ${project} → ${path} names no project; ${renamedTo} has the same remote — renamed`,
      say: `Bind ${renamedTo} to the folder`,
      command: `pal cli project set-path ${renamedTo} ${path}`,
    };

  return {
    project,
    title: `Binding ${project} → ${path} names no project — renamed or deleted`,
    say: "Remove the binding",
    command: `pal cli project unset-path ${project}`,
  };
}

/** "Points at" rather than "bound to": the path may come from a legacy record's own field. */
function bindingProblem(issue: BindingIssue): BindingProblem {
  if (issue.kind === "missing")
    return {
      project: issue.project,
      title: `Project ${issue.project} points at ${issue.path}, which does not exist`,
      ...pointAtCheckout(issue.project),
    };

  if (issue.kind === "orphan") return orphanProblem(issue);

  return {
    project: issue.projects[0],
    title: `Projects ${issue.projects.join(" and ")} both point at ${issue.path} — rebind whichever is wrong`,
    ...pointAtCheckout(issue.projects[0]),
  };
}

export function bindingFinding(issue: BindingIssue): Finding {
  const { project, title, say, command } = bindingProblem(issue);

  return warning(`binding.${project}`, title, { say, command, external: false });
}

/** A write that bypassed writeBindings left the file and its history apart; the history is what PAL itself wrote. */
export function bindingDriftFinding(drift: BindingChange[]): Finding | null {
  if (drift.length === 0) return null;
  const names = drift.map((d) => d.project).join(", ");

  return warning(
    "bindings.drift",
    `bindings.json differs from its history in ${drift.length} binding(s): ${names}`,
    {
      say: "Rewrite it from the history, or run `pal cli project bindings adopt` if you changed it on purpose",
      command: "pal cli project bindings rebuild",
      external: false,
    }
  );
}

function bindingFindings(): Finding[] {
  const drift = hasBindingHistory() ? bindingDriftFinding(bindingDrift()) : null;
  const issues = [...auditBindings().map(bindingFinding), ...(drift ? [drift] : [])];

  return issues.length === 0 ? [passed("bindings", "Project bindings healthy")] : issues;
}

function resolves(name: string, from: string): boolean {
  try {
    Bun.resolveSync(`${name}/package.json`, from);

    return true;
  } catch {
    try {
      Bun.resolveSync(name, from);

      return true;
    } catch {
      return false;
    }
  }
}

export function unresolvedDependencies(pkg: string): string[] {
  try {
    const { dependencies = {} } = JSON.parse(
      readFileSync(resolve(pkg, "package.json"), "utf-8")
    );

    return Object.keys(dependencies).filter((name) => !resolves(name, pkg));
  } catch {
    return [];
  }
}

function dependencyFinding(): Finding {
  const missing = unresolvedDependencies(palPkg());

  return missing.length === 0
    ? passed("dependencies", "Dependencies installed")
    : failing(
        "dependencies",
        `PAL's dependencies do not resolve: ${missing.join(", ")}`,
        {
          say: "Install them",
          command: "pal cli install",
          external: false,
        }
      );
}

const REVIEW_LEGACY_OPINIONS = {
  say: "Review them and re-add the ones worth keeping",
  command: "pal cli rule legacy-opinions",
  external: false,
};

export function legacyOpinionsFindings(legacy: LegacyOpinions): Finding[] {
  if (legacy.state === "unreadable")
    return [
      warning(
        "legacy-opinions",
        `The old opinion tracker's opinions.json cannot be read — ${legacy.reason}`,
        REVIEW_LEGACY_OPINIONS
      ),
    ];

  if (legacy.state === "missing" || legacy.opinions.length === 0) return [];
  const count = legacy.opinions.length;

  return [
    warning(
      "legacy-opinions",
      `${opinionCount(count)} from the old opinion tracker ${count === 1 ? "is" : "are"} no longer in use — the ones still loading from the old context file stop loading when the first new opinion is approved`,
      REVIEW_LEGACY_OPINIONS
    ),
  ];
}

/** A quarantined copy holds edits the live file may lack; only the user can merge them. */
export function syncQuarantineFindings(home: string): Finding[] {
  const count = quarantineCount(home);
  if (count === 0) return [];

  return [
    warning(
      "sync.quarantine",
      `${count} file(s) differed from the sync account and wait unmerged in ${resolve(home, "backups", "sync-quarantine")}`,
      { say: "Merge what each copy adds into its live file, then delete the copy" }
    ),
  ];
}

export function stateFindings(): Finding[] {
  const home = palHome();

  return [
    ...telosFindings(home),
    ...settingsFindings(),
    ...bindingFindings(),
    ...syncQuarantineFindings(home),
    ...legacyOpinionsFindings(readLegacyOpinions()),
    dependencyFinding(),
  ];
}

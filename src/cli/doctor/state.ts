import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { palHome, palPkg } from "../../hooks/lib/paths";
import { auditBindings, type BindingIssue } from "../../hooks/lib/projects";
import { telosStatus } from "../../hooks/lib/telos-topics";
import { type Finding, failing, optional, passed, warning } from "./finding";

interface SchemaNode {
  type?: string;
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

function settingsPath(): string {
  return resolve(palHome(), "memory", "pal-settings.json");
}

function readSettingsSchema(): SchemaNode | null {
  try {
    return JSON.parse(
      readFileSync(
        resolve(palPkg(), "assets", "schema", "pal-settings.schema.json"),
        "utf-8"
      )
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
    `pal-settings.json has ${noun} PAL ignores: ${keys.map(describeUnknownKey).join(", ")}`,
    { say: `Rename or remove them in ${settingsPath()}` }
  );
}

function settingsFindings(): Finding[] {
  const path = settingsPath();
  if (!existsSync(path))
    return [
      warning("settings.missing", "pal-settings.json is missing", {
        say: "Recreate it",
        command: "pal cli install",
      }),
    ];
  let settings: unknown;
  try {
    settings = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    return [
      failing(
        "settings.unreadable",
        `pal-settings.json is not valid JSON: ${(error as Error).message}`,
        {
          say: `Fix the JSON in ${path} — PAL is running on defaults until then`,
        }
      ),
    ];
  }
  if (!isPlainObject(settings))
    return [
      failing("settings.unreadable", "pal-settings.json is not a JSON object", {
        say: `Fix ${path}`,
      }),
    ];
  const schema = readSettingsSchema();
  const unknown = schema ? unknownSettingsKeys(settings, schema) : [];
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

/** "Points at" rather than "bound to": the path may come from a legacy record's own field. */
function bindingProblem(issue: BindingIssue): { project: string; title: string } {
  if (issue.kind === "unlocatable")
    return {
      project: issue.project,
      title: `Project ${issue.project} is not checked out on this machine`,
    };
  if (issue.kind === "missing")
    return {
      project: issue.project,
      title: `Project ${issue.project} points at ${issue.path}, which does not exist`,
    };
  return {
    project: issue.projects[0],
    title: `Projects ${issue.projects.join(" and ")} both point at ${issue.path} — rebind whichever is wrong`,
  };
}

export function bindingFinding(issue: BindingIssue): Finding {
  const { project, title } = bindingProblem(issue);
  return warning(`binding.${project}`, title, {
    say: "Point it at its checkout",
    command: `pal cli project set-path ${project} <path>`,
  });
}

function bindingFindings(): Finding[] {
  const issues = auditBindings();
  return issues.length === 0
    ? [passed("bindings", "Project bindings healthy")]
    : issues.map(bindingFinding);
}

function dependencyFinding(): Finding {
  return existsSync(resolve(palPkg(), "node_modules"))
    ? passed("dependencies", "Dependencies installed")
    : failing("dependencies", "PAL's dependencies are not installed", {
        say: "Install them",
        command: "pal cli install",
      });
}

export function stateFindings(): Finding[] {
  const home = palHome();
  return [
    ...telosFindings(home),
    ...settingsFindings(),
    ...bindingFindings(),
    dependencyFinding(),
  ];
}

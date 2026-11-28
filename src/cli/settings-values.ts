import type { SchemaNode } from "./doctor/state";

type Tree = Record<string, unknown>;

const isTree = (value: unknown): value is Tree =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const MATCHES_TYPE: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === "string",
  boolean: (value) => typeof value === "boolean",
  number: (value) => typeof value === "number",
  integer: (value) => Number.isInteger(value),
  array: Array.isArray,
  object: isTree,
};

function ownProblem(value: unknown, schema: SchemaNode, path: string): string | null {
  const matches = schema.type ? MATCHES_TYPE[schema.type] : undefined;
  if (matches && !matches(value)) return `${path} must be ${schema.type}`;

  if (schema.enum && !schema.enum.includes(value))
    return `${path} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`;

  const outOfRange =
    typeof value === "number" &&
    ((schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum));

  return outOfRange ? `${path} must be ${schema.minimum}..${schema.maximum}` : null;
}

function childSchema(schema: SchemaNode, key: string): SchemaNode | undefined {
  const declared = schema.properties?.[key];
  if (declared) return declared;

  return isTree(schema.additionalProperties) ? schema.additionalProperties : undefined;
}

function childProblems(value: unknown, schema: SchemaNode, path: string): string[] {
  const items = schema.items;
  if (Array.isArray(value) && items)
    return value.flatMap((item, i) =>
      settingsValueProblems(item, items, `${path}[${i}]`)
    );

  if (!isTree(value)) return [];

  return Object.entries(value).flatMap(([key, child]) => {
    const node = childSchema(schema, key);

    return node ? settingsValueProblems(child, node, path ? `${path}.${key}` : key) : [];
  });
}

/** Values of the wrong type, outside their enum or range; unknown keys are the doctor's to report. */
export function settingsValueProblems(
  value: unknown,
  schema: SchemaNode,
  path = ""
): string[] {
  const own = ownProblem(value, schema, path || "the settings");

  return own ? [own] : childProblems(value, schema, path);
}

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type declaredSchema from "../assets/schema/settings.schema.json";
import { type SchemaNode, unknownSettingsKeys } from "../src/cli/doctor/state";
import { settingsValueProblems } from "../src/cli/settings-values";
import type { PalSettingsData } from "../src/core/settings";

const SCHEMAS = resolve(import.meta.dir, "..", "assets", "schema");
const FIXTURES = resolve(SCHEMAS, "fixtures");
const json = (path: string) => JSON.parse(readFileSync(path, "utf-8"));
const schema: SchemaNode = json(resolve(SCHEMAS, "settings.schema.json"));
const topLevelKeys = Object.keys(schema.properties ?? {}).filter((k) => k !== "$schema");

type NamedKeys<T> = keyof { [K in keyof T as string extends K ? never : K]: T[K] };
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const typeAndSchemaAgree: Same<
  NamedKeys<PalSettingsData>,
  Exclude<keyof typeof declaredSchema.properties, "$schema">
> = true;

interface NamedNode {
  path: string;
  node: SchemaNode;
  insideList: boolean;
}

function namedNodes(node: SchemaNode, path = "", insideList = false): NamedNode[] {
  const own = path ? [{ path, node, insideList }] : [];
  const children = Object.entries(node.properties ?? {}).flatMap(([key, child]) =>
    namedNodes(child, path ? `${path}.${key}` : key, insideList)
  );
  const items = node.items ? namedNodes(node.items, `${path}[]`, true) : [];
  const extra =
    typeof node.additionalProperties === "object"
      ? namedNodes(node.additionalProperties, `${path}.*`, insideList)
      : [];

  return [...own, ...children, ...items, ...extra];
}

const isSection = (node: SchemaNode) => node.properties !== undefined;
const ownsAnExample = ({ node, path, insideList }: NamedNode) =>
  isSection(node) || insideList || path.endsWith(".*") || path.endsWith("[]");

describe("the settings schema", () => {
  test("the template points at a schema PAL ships", () => {
    const template = json(resolve(SCHEMAS, "..", "templates", "settings.json"));
    expect(existsSync(resolve(SCHEMAS, basename(template.$schema)))).toBe(true);
  });

  test("its former name still leads to it, for files written before the rename", () => {
    const former = json(resolve(SCHEMAS, "pal-settings.schema.json"));
    expect(json(resolve(SCHEMAS, former.$ref)).title).toBe("PAL settings");
  });

  test("declares the same top-level keys as the settings type", () => {
    expect(typeAndSchemaAgree).toBe(true);
  });
});

describe("the schema documents itself", () => {
  test("every key says what it does", () => {
    const silent = namedNodes(schema).filter(({ node }) => !node.description);
    expect(silent.map(({ path }) => path)).toEqual([]);
  });

  test("every value has a default or an example", () => {
    const bare = namedNodes(schema).filter(
      (named) =>
        !ownsAnExample(named) &&
        named.node.default === undefined &&
        named.node.examples === undefined
    );
    expect(bare.map(({ path }) => path)).toEqual([]);
  });

  test("every default and example is a value the schema accepts", () => {
    const wrong = namedNodes(schema).flatMap(({ path, node }) =>
      [
        ...(node.default === undefined ? [] : [node.default]),
        ...(node.examples ?? []),
      ].flatMap((value) => settingsValueProblems(value, node, path))
    );
    expect(wrong).toEqual([]);
  });
});

describe("the fixtures", () => {
  const fixtures = readdirSync(FIXTURES).map((file) => ({
    key: basename(file, ".json"),
    settings: json(resolve(FIXTURES, file)),
  }));

  test("one per top-level key", () => {
    expect(fixtures.map(({ key }) => key).sort()).toEqual([...topLevelKeys].sort());
  });

  test.each(fixtures)(
    "$key sets only its own key, to values the schema accepts",
    ({ key, settings }) => {
      expect(Object.keys(settings)).toEqual([key]);
      expect(unknownSettingsKeys(settings, schema)).toEqual([]);
      expect(settingsValueProblems(settings, schema)).toEqual([]);
    }
  );

  test("the shipped template is a settings file the schema accepts", () => {
    const template = json(resolve(SCHEMAS, "..", "templates", "settings.json"));
    expect(unknownSettingsKeys(template, schema)).toEqual([]);
    expect(settingsValueProblems(template, schema)).toEqual([]);
  });
});

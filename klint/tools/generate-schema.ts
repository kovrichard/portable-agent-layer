#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringify as toYaml } from "yaml";
import { KlintConfigSchema } from "../core/config.schema";
import { BUILT_IN_PLUGINS } from "../plugins/index";
import { BUILT_IN_RULES } from "../rules/index";

const allKnownRuleNames = [
  ...Object.keys(BUILT_IN_RULES),
  ...Object.values(BUILT_IN_PLUGINS).flatMap((p) => Object.keys(p.rules)),
];

const raw = KlintConfigSchema.toJSONSchema() as Record<string, unknown>;

// VS Code reads `properties` for key autocomplete, not `propertyNames`.
// Expand known rule names into explicit property entries so editors suggest them.
// `additionalProperties` stays to allow custom rule names without validation errors.
const rulesSchema = (raw.properties as Record<string, Record<string, unknown>>).rules;
const valueSchema = rulesSchema.additionalProperties;
rulesSchema.properties = Object.fromEntries(
  allKnownRuleNames.map((name) => [name, valueSchema])
);
delete rulesSchema.propertyNames;

// Remove the 2020-12 $schema key; set Draft-07 for broad editor compatibility
delete raw.$schema;

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://klint.dev/schema.json",
  ...raw,
};

const jsonOutPath = resolve(import.meta.dir, "../../klint.schema.json");
writeFileSync(jsonOutPath, `${JSON.stringify(schema, null, 2)}\n`);
process.stdout.write(`Generated ${jsonOutPath}\n`);

const yamlOutPath = resolve(import.meta.dir, "../../klint.schema.yaml");
writeFileSync(yamlOutPath, toYaml(schema, { lineWidth: 120 }));
process.stdout.write(`Generated ${yamlOutPath}\n`);

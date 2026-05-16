import { z } from "zod";
import { BUILT_IN_PLUGINS } from "../plugins/index";
import { BUILT_IN_RULES } from "../rules/index";

const builtInRuleNames = Object.keys(BUILT_IN_RULES) as [string, ...string[]];
const builtInPluginNames = Object.keys(BUILT_IN_PLUGINS) as [string, ...string[]];
const pluginRuleNames = [
  ...new Set(Object.values(BUILT_IN_PLUGINS).flatMap((p) => Object.keys(p.rules))),
] as [string, ...string[]];
const allKnownRuleNames = [...new Set([...builtInRuleNames, ...pluginRuleNames])] as [
  string,
  ...string[],
];

const SeveritySchema = z
  .enum(["error", "warn", "off"])
  .describe(
    'Rule severity. "error" exits with code 2; "warn" reports but exits 0; "off" silences.'
  );

const RuleNameSchema = z
  .union([z.enum(allKnownRuleNames), z.string()])
  .describe(
    "Built-in or plugin rule name (with autocomplete) or a custom rule name defined in klint.rules.ts."
  );

const RuleOptionsSchema = z
  .object({
    severity: SeveritySchema.optional(),
    include: z
      .array(z.string())
      .optional()
      .describe(
        'Glob patterns scoping this rule to a subset of files. Prefix with ! to exclude. Example: ["src/hooks/**", "!src/hooks/scripts/**"]'
      ),
  })
  .strict()
  .describe(
    'Rule options object. Omit severity to default to "error". Add include to scope the rule to specific files.'
  );

export const KlintConfigSchema = z
  .object({
    $schema: z
      .string()
      .optional()
      .describe(
        "JSON Schema reference. Use ./klint.schema.json for local validation or https://klint.dev/schema.json for the published schema."
      ),
    root: z
      .string()
      .optional()
      .describe(
        "Root directory used to resolve include paths and report relative file names. Defaults to the directory containing klint.config.json."
      ),
    include: z
      .array(z.string())
      .optional()
      .describe(
        'Glob patterns selecting which TypeScript files to lint. Prefix with ! to exclude. Defaults to ["."] which lints all .ts files under root. Example: ["src", "klint", "!**/node_modules/**"]'
      ),
    plugins: z
      .array(z.enum(builtInPluginNames))
      .optional()
      .describe(
        'Named rule bundles to enable. Each plugin applies a default set of rules at "error" severity. Individual rules from the bundle can be overridden or silenced via the rules map. Available: "sonar".'
      ),
    rules: z
      .record(RuleNameSchema, z.union([SeveritySchema, RuleOptionsSchema]))
      .optional()
      .describe(
        'Map of rule name → severity or options. Example: { "no-floating-promise": "error", "no-sync-in-async": { "severity": "warn", "include": ["src/hooks/**"] } }. Run `klint --help` for the full rule list.'
      ),
    arch: z
      .unknown()
      .optional()
      .describe(
        "Architecture as Code constraints — layers, import boundaries, forbidden patterns, singleton locations. Parsed by the arch engine (Phase 2)."
      ),
  })
  .strict()
  .describe(
    "klint configuration. Lives at klint.yaml (or klint.config.json) next to biome.json and knip.json."
  );

/** @lintignore */
export type KlintConfigFile = z.infer<typeof KlintConfigSchema>;

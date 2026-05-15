import { z } from "zod";
import { BUILT_IN_RULES } from "../rules/index";

const builtInRuleNames = Object.keys(BUILT_IN_RULES);

const RuleNameSchema = z
  .union([z.enum(builtInRuleNames), z.string()])
  .describe(
    "Built-in rule name (with autocomplete) or a custom rule name defined in klint.rules.ts."
  );

const RuleScopedEntrySchema = z
  .object({
    rule: RuleNameSchema.describe("Name of the built-in or custom rule to apply."),
    include: z
      .array(z.string())
      .describe(
        'Glob patterns scoping this rule to a subset of files. Prefix with ! to exclude. Example: ["src/hooks/**", "!src/hooks/scripts/**"]'
      ),
  })
  .strict()
  .describe(
    "A rule entry that applies a named rule only to files matching the given include patterns."
  );

const RuleEntrySchema = z
  .union([RuleNameSchema, RuleScopedEntrySchema])
  .describe(
    "Either a rule name (string) or an object scoping a named rule to specific files."
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
    rules: z
      .array(RuleEntrySchema)
      .optional()
      .describe(
        "Built-in rules to enforce. Each entry is either a rule name string or a scoped object restricting the rule to a file subset. Run `klint --help` for the full rule list."
      ),
    customRules: z
      .array(z.string())
      .optional()
      .describe(
        "Names of custom rules exported from klint.rules.ts (or the file passed via --rules). Custom rules run after built-in rules."
      ),
  })
  .strict()
  .describe(
    "klint configuration. Lives at klint.config.json next to biome.json and knip.json."
  );

/** @lintignore */
export type KlintConfigFile = z.infer<typeof KlintConfigSchema>;

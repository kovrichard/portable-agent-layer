#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { KlintConfigSchema } from "../core/config.schema";

const schema = {
  $id: "https://klint.dev/schema.json",
  ...KlintConfigSchema.toJSONSchema(),
};

const outPath = resolve(import.meta.dir, "../../klint.schema.json");
writeFileSync(outPath, `${JSON.stringify(schema, null, 2)}\n`);
process.stdout.write(`Generated ${outPath}\n`);

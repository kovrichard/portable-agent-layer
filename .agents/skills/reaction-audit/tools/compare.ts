#!/usr/bin/env bun
/**
 * compare — read the model's labels ({ "<id>": "<reaction>" }) from a JSON file
 * and print where they disagree with the rules, as JSON.
 */

import { readSamples } from "../../../../src/hooks/lib/interaction-samples";
import { compareLabels } from "../../../../src/hooks/lib/reaction-audit";

const file = process.argv[2];
if (!file) {
  console.error("usage: compare.ts <labels.json>");
  process.exit(1);
}
const labels = JSON.parse(await Bun.file(file).text());
console.log(JSON.stringify(compareLabels(readSamples(), labels), null, 2));

#!/usr/bin/env bun
/**
 * samples — print the messages labelled since the last audit, without the
 * rule's label, as JSON: [{ id, text, replyEnd }]. Pass --all for every sample.
 */

import { blindSamples, unauditedSamples } from "../../../../src/hooks/lib/reaction-audit";

const samples = process.argv.includes("--all")
  ? unauditedSamples(null)
  : unauditedSamples();
console.log(JSON.stringify(blindSamples(samples), null, 2));

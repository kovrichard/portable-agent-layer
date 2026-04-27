#!/usr/bin/env bun
import { listTemplates } from "./lib/registry";

async function main() {
  const all = await listTemplates();
  if (all.length === 0) {
    console.log("no templates registered. run setup-template.ts to add one.");
    return;
  }
  const nameW = Math.max(4, ...all.map((t) => t.name.length));
  console.log(`${"NAME".padEnd(nameW)}  PRIMARY    ASPECT  PATH`);
  for (const t of all) {
    console.log(
      `${t.name.padEnd(nameW)}  ${t.meta.primary}  ${t.meta.aspect.padEnd(6)}  ${t.path}`
    );
  }
}
main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});

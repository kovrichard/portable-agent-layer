#!/usr/bin/env bun
/**
 * Eval runner — maps PAL env vars to the standard names promptfoo expects,
 * then delegates to promptfoo. Any extra argv is forwarded (e.g. --verbose).
 *
 * Usage: bun eval/run.ts <name> [promptfoo args...]
 *   bun eval/run.ts reaction --filter-providers haiku --no-cache
 *
 * Each <name> maps to eval/<name>/promptfoo.yaml.
 */
import { mkdir } from "node:fs/promises";

// promptfoo probes its cwd for promptfooconfig.* and redteam.* even with -c. At
// .cts it imports tsx before checking the file exists, and tsx's loader cannot
// run under Bun. A .yaml is probed first, so an empty one ends the search.
async function stubDefaultConfigs(dir: string) {
  for (const name of ["promptfooconfig", "redteam"]) {
    const stub = Bun.file(`${dir}${name}.yaml`);
    if (!(await stub.exists())) await Bun.write(stub, "{}\n");
  }
}

if (!process.env.ANTHROPIC_API_KEY && process.env.PAL_ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.PAL_ANTHROPIC_API_KEY;
}
if (!process.env.OPENAI_API_KEY && process.env.PAL_OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.PAL_OPENAI_API_KEY;
}

const name = Bun.argv[2];
if (!name || name.startsWith("-")) {
  console.error("Usage: bun eval/run.ts <name> [promptfoo args...]");
  process.exit(1);
}

const configPath = new URL(`${name}/promptfoo.yaml`, import.meta.url).pathname;

// Promptfoo writes promptfoo-errors.log to its cwd — keep it out of the repo root.
const logsDir = new URL("logs/", import.meta.url).pathname;
await mkdir(logsDir, { recursive: true });
await stubDefaultConfigs(logsDir);

const proc = Bun.spawn(
  ["bunx", "promptfoo", "eval", "-c", configPath, ...Bun.argv.slice(3)],
  {
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    cwd: logsDir,
  }
);

process.exit(await proc.exited);

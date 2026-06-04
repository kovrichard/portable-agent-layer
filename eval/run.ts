#!/usr/bin/env bun
/**
 * Eval runner — maps PAL env vars to the standard names promptfoo expects,
 * then delegates to promptfoo@latest. Any extra argv is forwarded (e.g. --verbose).
 *
 * Usage: bun eval/run.ts [promptfoo args...]
 */
import { mkdir } from "node:fs/promises";

if (!process.env.ANTHROPIC_API_KEY && process.env.PAL_ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.PAL_ANTHROPIC_API_KEY;
}
if (!process.env.OPENAI_API_KEY && process.env.PAL_OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.PAL_OPENAI_API_KEY;
}

// Promptfoo writes promptfoo-errors.log to its cwd — keep it out of the repo root.
const logsDir = new URL("logs/", import.meta.url).pathname;
await mkdir(logsDir, { recursive: true });

const configPath = new URL("sentiment/promptfoo.yaml", import.meta.url).pathname;

const proc = Bun.spawn(
  ["bunx", "promptfoo", "eval", "-c", configPath, ...Bun.argv.slice(2)],
  {
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    cwd: logsDir,
  }
);

process.exit(await proc.exited);

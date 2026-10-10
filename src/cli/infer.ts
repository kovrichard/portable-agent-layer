/**
 * pal cli infer — one inference call through PAL's own route, for programs
 * outside an agent session. The route, its model for each tier, and the
 * isolation from PAL's hooks are the same ones PAL's background calls use.
 */

import { readFileSync } from "node:fs";
import { z } from "zod";
import { inference } from "../hooks/lib/inference";
import { INFERENCE_TIERS, type InferenceTier } from "../hooks/lib/models";
import { leaf } from "../tools/lib/command";

const DEFAULT_TIMEOUT_SECONDS = 60;

interface InferValues {
  tier?: string;
  system?: string;
  schema?: string;
  timeout?: string;
  caller?: string;
}

type Infer = typeof inference;

class InferInputError extends Error {}

function tierOf(name = "small"): InferenceTier {
  const tier = INFERENCE_TIERS.find((known) => known === name);
  if (!tier) {
    throw new InferInputError(
      `Unknown tier "${name}". Use ${INFERENCE_TIERS.join(", ")}.`
    );
  }
  return tier;
}

function timeoutMs(seconds = String(DEFAULT_TIMEOUT_SECONDS)): number {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) {
    throw new InferInputError(`--timeout takes a number of seconds, not "${seconds}".`);
  }
  return value * 1000;
}

function promptOf(stdin: string): string {
  const prompt = stdin.trim();
  if (!prompt) throw new InferInputError("No prompt: pipe it in on stdin.");
  return prompt;
}

function readSchema(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    throw new InferInputError(`--schema ${path} is not a readable JSON file.`);
  }
}

function assertCheckable(path: string, schema: Record<string, unknown>): void {
  try {
    z.fromJSONSchema(schema);
  } catch (err) {
    throw new InferInputError(
      `--schema ${path} cannot be checked: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function schemaFrom(path: string | undefined): Record<string, unknown> | undefined {
  if (!path) return undefined;
  const schema = readSchema(path);
  assertCheckable(path, schema);
  return schema;
}

function requestFrom(values: InferValues, stdin: string): Parameters<Infer>[0] {
  return {
    user: promptOf(stdin),
    system: values.system ? readFileSync(values.system, "utf-8") : undefined,
    jsonSchema: schemaFrom(values.schema),
    tier: tierOf(values.tier),
    timeout: timeoutMs(values.timeout),
    caller: values.caller ?? "cli-infer",
  };
}

function failureReason(result: Awaited<ReturnType<Infer>>, wantedJson: boolean): string {
  if (result.error) return result.error;
  if (wantedJson && result.output) return "the reply was not JSON";
  return "no inference route answered (run `pal cli doctor`)";
}

export async function inferFromCli(
  values: InferValues,
  stdin: string,
  infer: Infer = inference
): Promise<number> {
  let request: Parameters<Infer>[0];
  try {
    request = requestFrom(values, stdin);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const result = await infer(request);
  if (!result.success || !result.output) {
    console.error(
      `Inference failed: ${failureReason(result, Boolean(request.jsonSchema))}`
    );
    return 1;
  }
  console.log(result.output);
  return 0;
}

export const inferCommand = leaf({
  summary: "Run one inference call on the active agent's model; prompt on stdin",
  options: {
    tier: {
      type: "string",
      value: "<tier>",
      description: `Model size: ${INFERENCE_TIERS.join(" or ")} (default small)`,
    },
    system: { type: "string", value: "<file>", description: "System prompt file" },
    schema: {
      type: "string",
      value: "<file>",
      description: "JSON schema file; a reply that doesn't match it fails",
    },
    timeout: {
      type: "string",
      value: "<seconds>",
      description: `Give up after this long (default ${DEFAULT_TIMEOUT_SECONDS})`,
    },
    caller: {
      type: "string",
      value: "<label>",
      description: "Label for PAL's debug log",
    },
  },
  run: async ({ values }) => inferFromCli(values, await Bun.stdin.text()),
});

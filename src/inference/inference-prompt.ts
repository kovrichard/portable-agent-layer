import type { InferenceOptions } from "./inference-types";

/**
 * Render a JSON schema for a prompt without double quotes.
 *
 * Bun.spawn resolves an agent CLI on Windows to its `.cmd` shim, which npm
 * installs it as, and cmd.exe re-parses the command line it is handed. A double
 * quote inside an argv element does not survive that round trip: the child exits
 * non-zero having written nothing, so the dispatcher sees an empty abort and
 * gives up. Single quotes carry the same shape to a model and are inert to
 * cmd.exe, so the schema travels intact on every platform.
 */
function schemaForPrompt(schema: Record<string, unknown>): string {
  return JSON.stringify(schema).replaceAll('"', "'");
}

/** The one instruction line that asks a CLI agent for schema-shaped JSON. */
export function schemaInstruction(schema: Record<string, unknown>): string {
  return `Respond with ONLY a JSON value matching this schema (no prose, no markdown): ${schemaForPrompt(schema)}`;
}

/** system + user + schema instruction, the single prompt a CLI agent receives. */
export function buildCliPrompt(opts: InferenceOptions): string {
  const parts: string[] = [];

  if (opts.system) parts.push(opts.system);
  parts.push(opts.user);

  if (opts.jsonSchema) parts.push(schemaInstruction(opts.jsonSchema));

  return parts.join("\n\n");
}

/** Append a JSON-schema instruction to the system prompt (PAI pattern). */
export function injectJsonSchemaInstruction(
  systemPrompt: string,
  schema: Record<string, unknown>
): string {
  const schemaLine = schemaInstruction(schema);

  return systemPrompt ? `${systemPrompt}\n\n${schemaLine}` : schemaLine;
}

/** Extract a JSON object or array from raw text output. Returns null on failure. */
export function parseJsonFromOutput(output: string): unknown | null {
  const objectMatch = /\{[\s\S]*\}/.exec(output);
  const arrayMatch = /\[[\s\S]*\]/.exec(output);

  for (const candidate of [objectMatch?.[0], arrayMatch?.[0]]) {
    if (!candidate) continue;

    try {
      return JSON.parse(candidate);
    } catch {
      /* try next */
    }
  }

  return null;
}

export function agentFailureText(stdout: string): string {
  try {
    const result = (JSON.parse(stdout) as { result?: unknown }).result;

    return typeof result === "string" ? result : stdout;
  } catch {
    return stdout;
  }
}

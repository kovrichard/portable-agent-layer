export type Usage = Record<string, unknown>;

export function message(
  id: string,
  model: string,
  usage: Usage,
  options: { ts?: string; tools?: number } = {}
) {
  const content: Record<string, unknown>[] = [{ type: "text", text: "ok" }];

  for (let i = 0; i < (options.tools ?? 0); i++) {
    content.push({ type: "tool_use", id: `${id}-t${i}`, name: "Bash", input: {} });
  }

  return {
    type: "assistant",
    timestamp: options.ts ?? "2026-11-08T08:00:01.000Z",
    message: { id, model, usage, content },
  };
}

export const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n");

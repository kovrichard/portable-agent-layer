import { noteHookPayload } from "./hook-run";

/** Read all of stdin as a string */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** Read stdin and parse as JSON, returning null on failure */
export async function readStdinJSON<T = unknown>(): Promise<T | null> {
  try {
    const payload = JSON.parse(await readStdin()) as T;
    noteHookPayload(payload);
    return payload;
  } catch {
    return null;
  }
}

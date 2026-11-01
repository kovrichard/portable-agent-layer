import { readFileSync } from "node:fs";

function channelFromFile(path: string | undefined): string | null {
  if (!path) return null;
  try {
    return readFileSync(path, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Where the current message came from. A long-lived process serving several
 * channels names a file in PAL_CHANNEL_FILE and rewrites it before each message,
 * because its environment is fixed at spawn; PAL_CHANNEL is the per-process fallback.
 */
export function currentChannel(env: NodeJS.ProcessEnv = process.env): string | null {
  return channelFromFile(env.PAL_CHANNEL_FILE) ?? (env.PAL_CHANNEL || null);
}

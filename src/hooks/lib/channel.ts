import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

interface ChannelLine {
  sha256: string;
  channel: string;
}

function parseLine(line: string): ChannelLine | null {
  try {
    const parsed = JSON.parse(line) as Partial<ChannelLine>;
    return typeof parsed.channel === "string" && parsed.channel
      ? (parsed as ChannelLine)
      : null;
  } catch {
    return null;
  }
}

function channelLines(path: string | undefined): ChannelLine[] {
  if (!path) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .map(parseLine)
      .filter((line): line is ChannelLine => line !== null);
  } catch {
    return [];
  }
}

function hashOf(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

/** Claude Code runs a queued message's prompt hook only when it takes the message in, often after later messages were written. */
function ownChannel(
  lines: ChannelLine[],
  prompt: string | undefined
): string | undefined {
  if (prompt === undefined) return undefined;
  const sha = hashOf(prompt);
  return lines.findLast((line) => line.sha256 === sha)?.channel;
}

export function currentChannel(
  prompt?: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const lines = channelLines(env.PAL_CHANNEL_FILE);
  return ownChannel(lines, prompt) ?? lines.at(-1)?.channel ?? (env.PAL_CHANNEL || null);
}

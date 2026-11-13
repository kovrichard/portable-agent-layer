import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { palPkg } from "../hooks/lib/paths";

function latestTranscript(projectsDir: string): string {
  let latestFile = "";
  let latestMtime = 0;

  for (const project of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const dir = resolve(projectsDir, project.name);

    for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
      const filepath = resolve(dir, file);
      const { mtimeMs } = statSync(filepath);
      if (mtimeMs > latestMtime) {
        latestMtime = mtimeMs;
        latestFile = filepath;
      }
    }
  }

  return latestFile;
}

function sessionIdOf(line: string): string | undefined {
  try {
    return JSON.parse(line).sessionId;
  } catch {
    return undefined;
  }
}

function summarizeSession(transcript: string): void {
  if (!transcript) return;
  const lastLine = readFileSync(transcript, "utf-8").trim().split("\n").pop();
  const sessionId = lastLine ? sessionIdOf(lastLine) : undefined;
  if (!sessionId) return;
  const summaryScript = resolve(palPkg(), "src", "tools", "session-summary.ts");
  spawnSync("bun", ["run", summaryScript, "--", "--session", sessionId], {
    stdio: "inherit",
  });
}

export function summarizeLatestSession(projectsDir: string): void {
  summarizeSession(latestTranscript(projectsDir));
}

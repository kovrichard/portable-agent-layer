import { relative } from "node:path";
import { appendEvent, logQuietly } from "../../bronze/events";
import { type HookTurnPayload, hookSessionId } from "../../core/hook-payload";
import { palHome } from "../../core/paths";
import { buildClaudeMd } from "./claude-md";
import { getSemiStaticSources, readFileSafe } from "./semi-static";

interface InjectedFile {
  path: string;
  text: string;
}

function semiStaticTexts(): InjectedFile[] {
  return getSemiStaticSources().map((source) => ({
    path: relative(palHome(), source.path).replaceAll("\\", "/"),
    text: readFileSafe(source.path),
  }));
}

function charsIn(files: InjectedFile[]): number {
  return files.reduce((sum, file) => sum + file.text.length, 0);
}

/** Chars, not tokens: no tokenizer runs at session start. */
export function logContextInjected(
  payload: HookTurnPayload | null,
  reminder: string,
  now: Date = new Date()
): void {
  logQuietly("context_injected", () => {
    const instructions = buildClaudeMd();
    const semiStatic = semiStaticTexts();
    appendEvent(
      "context_injected",
      {
        instructionsChars: instructions.length,
        semiStaticChars: charsIn(semiStatic),
        dynamicChars: reminder.length,
      },
      {
        ts: now.toISOString(),
        session: hookSessionId(payload) ?? null,
        content: { instructions, semiStatic, dynamic: reminder },
      }
    );
  });
}

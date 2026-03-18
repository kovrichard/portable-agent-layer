import { execSync } from "node:child_process";

/** Send a desktop notification (macOS + Linux) */
export function desktopNotify(title: string, message: string): void {
  try {
    if (process.platform === "darwin") {
      execSync(
        `osascript -e 'display notification "${esc(message)}" with title "${esc(title)}"'`,
        { timeout: 3000 }
      );
    } else {
      execSync(`notify-send "${esc(title)}" "${esc(message)}"`, {
        timeout: 3000,
      });
    }
  } catch {
    // Notifications are best-effort
  }
}

/** Speak text aloud (macOS `say`, Linux `espeak`) */
export function speak(text: string): void {
  if (process.env.PAI_VOICE_ENABLED !== "1") return;
  const short = text.slice(0, 200);
  try {
    if (process.platform === "darwin") {
      const voice = process.env.PAI_VOICE_NAME || "Samantha";
      execSync(`say -v "${voice}" "${esc(short)}"`, { timeout: 15000 });
    } else {
      execSync(`espeak "${esc(short)}"`, { timeout: 15000 });
    }
  } catch {
    // Voice is best-effort
  }
}

/** Set terminal tab title */
export function setTabTitle(title: string): void {
  process.stdout.write(`\x1b]0;${title}\x07`);
}

function esc(s: string): string {
  return s.replace(/"/g, '\\"').replace(/\n/g, " ");
}

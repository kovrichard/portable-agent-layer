/**
 * Cross-platform desktop notification primitive.
 *
 * macOS  : osascript "display notification"
 * Linux  : notify-send (libnotify)
 * Windows: PowerShell NotifyIcon (Win10+ surfaces this as a toast)
 *
 * All implementations fail silently if the underlying command is missing —
 * notifications are non-essential, never surface as errors.
 */

import { spawn } from "node:child_process";

function spawnSilent(cmd: string, args: string[]): Promise<void> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: "ignore", windowsHide: true });
    p.on("close", () => res());
    p.on("error", () => res());
  });
}

function escapeAppleScript(s: string): string {
  return s.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapePowerShellSingle(s: string): string {
  return s.replaceAll("'", "''");
}

export async function notify(title: string, body: string): Promise<void> {
  if (process.platform === "darwin") {
    const script = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`;
    await spawnSilent("osascript", ["-e", script]);
    return;
  }
  if (process.platform === "linux") {
    await spawnSilent("notify-send", [title, body]);
    return;
  }
  if (process.platform === "win32") {
    const t = escapePowerShellSingle(title);
    const b = escapePowerShellSingle(body);
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "$n = New-Object System.Windows.Forms.NotifyIcon;",
      "$n.Icon = [System.Drawing.SystemIcons]::Information;",
      "$n.Visible = $true;",
      `$n.ShowBalloonTip(3000, '${t}', '${b}', 'Info');`,
      "Start-Sleep -Seconds 3;",
      "$n.Dispose()",
    ].join(" ");
    await spawnSilent("powershell.exe", ["-NoProfile", "-Command", ps]);
    return;
  }
}

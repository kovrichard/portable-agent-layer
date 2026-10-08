/**
 * What the terminal PAL is printing to can show. Rich output (the banner, the
 * rail, colours) is for a person at a terminal; anything else, an agent's tool
 * call or a CI log, gets short plain lines.
 */

type ColorDepth = "none" | "256" | "truecolor";

export interface Terminal {
  rich: boolean;
  color: ColorDepth;
  unicode: boolean;
  width: number;
}

export interface TerminalProbe {
  env: Record<string, string | undefined>;
  isTTY: boolean;
  columns?: number;
  platform: NodeJS.Platform;
}

const TRUECOLOR_PROGRAMS = new Set([
  "iTerm.app",
  "vscode",
  "WezTerm",
  "ghostty",
  "Hyper",
]);
const TRUECOLOR_TERMS = /truecolor|24bit|direct|kitty|alacritty|ghostty|wezterm/;

function forcedColor(env: TerminalProbe["env"]): ColorDepth | undefined {
  const force = env.FORCE_COLOR;
  if (force === undefined) return undefined;
  if (force === "0" || force === "false") return "none";
  return force === "3" ? "truecolor" : "256";
}

function supportsTruecolor({ env }: TerminalProbe): boolean {
  return (
    env.COLORTERM === "truecolor" ||
    env.COLORTERM === "24bit" ||
    env.WT_SESSION !== undefined ||
    TRUECOLOR_PROGRAMS.has(env.TERM_PROGRAM ?? "") ||
    TRUECOLOR_TERMS.test(env.TERM ?? "")
  );
}

function colorDepth(probe: TerminalProbe, rich: boolean): ColorDepth {
  if (probe.env.NO_COLOR) return "none";
  const forced = forcedColor(probe.env);
  if (forced === "none") return "none";
  if (!rich && !forced) return "none";
  if (forced === "truecolor" || supportsTruecolor(probe)) return "truecolor";
  return "256";
}

/** The legacy Windows console draws box and block characters as question marks. */
function supportsUnicode({ env, platform }: TerminalProbe): boolean {
  if (platform !== "win32") return true;
  return Boolean(env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuTask || env.TERM);
}

export function detectTerminal(probe: TerminalProbe = currentProbe()): Terminal {
  const rich = probe.isTTY && probe.env.TERM !== "dumb";
  return {
    rich,
    color: colorDepth(probe, rich),
    unicode: supportsUnicode(probe),
    width: probe.columns && probe.columns > 0 ? probe.columns : 80,
  };
}

function currentProbe(): TerminalProbe {
  return {
    env: process.env,
    isTTY: process.stdout.isTTY === true,
    columns: process.stdout.columns,
    platform: process.platform,
  };
}

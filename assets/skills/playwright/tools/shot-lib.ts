// Pure, side-effect-free helpers for the playwright skill tool.
// Kept separate from shot.ts so they can be unit-tested without launching a browser.

export type ShotOptions = {
  url: string;
  out: string;
  viewport?: { width: number; height: number };
  fullPage: boolean;
  selector?: string;
  waitMs?: number;
};

const USAGE =
  "usage: shot.ts <url> [-o <file>] [--viewport WxH] [--full-page] [--selector <css>] [--wait <ms>]";

export function parseArgs(argv: string[]): ShotOptions {
  let url = "";
  let out = "";
  let viewport: ShotOptions["viewport"];
  let fullPage = false;
  let selector: string | undefined;
  let waitMs: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") out = argv[++i] ?? "";
    else if (a === "--viewport") {
      const m = /^(\d+)[x,](\d+)$/.exec(argv[++i] ?? "");
      if (!m) throw new Error("--viewport expects WxH, e.g. 1440x900");
      viewport = { width: Number(m[1]), height: Number(m[2]) };
    } else if (a === "--full-page") fullPage = true;
    else if (a === "--selector") selector = argv[++i];
    else if (a === "--wait") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n)) throw new Error("--wait expects a number of milliseconds");
      waitMs = n;
    } else if (!a.startsWith("-") && !url) url = a;
    else throw new Error(`unknown argument: ${a}\n${USAGE}`);
  }

  if (!url) throw new Error(`a URL is required\n${USAGE}`);
  return { url, out, viewport, fullPage, selector, waitMs };
}

export type Tier = "cli" | "node";

/**
 * Decide which local engine to use. `playwright-cli` (Microsoft's stateful agent CLI)
 * is preferred when present, but its `screenshot` command cannot set a viewport or
 * capture full-page — so any request that needs exact size/full-page falls to the
 * Node-launched PAL Playwright, which honors them precisely.
 */
export function chooseTier(opts: {
  cliAvailable: boolean;
  viewport?: unknown;
  fullPage?: boolean;
}): Tier {
  if (!opts.cliAvailable) return "node";
  if (opts.viewport || opts.fullPage) return "node";
  return "cli";
}

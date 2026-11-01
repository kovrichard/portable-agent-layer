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

function parseViewport(raw: string | undefined): ShotOptions["viewport"] {
  const m = /^(\d+)[x,](\d+)$/.exec(raw ?? "");
  if (!m) throw new Error("--viewport expects WxH, e.g. 1440x900");
  return { width: Number(m[1]), height: Number(m[2]) };
}

function parseWait(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error("--wait expects a number of milliseconds");
  return n;
}

type ValueFlag = (opts: ShotOptions, value: string | undefined) => void;

const VALUE_FLAGS = new Map<string, ValueFlag>([
  ["-o", (o, v) => (o.out = v ?? "")],
  ["--out", (o, v) => (o.out = v ?? "")],
  ["--viewport", (o, v) => (o.viewport = parseViewport(v))],
  ["--selector", (o, v) => (o.selector = v)],
  ["--wait", (o, v) => (o.waitMs = parseWait(v))],
]);

export function parseArgs(argv: string[]): ShotOptions {
  const opts: ShotOptions = {
    url: "",
    out: "",
    viewport: undefined,
    fullPage: false,
    selector: undefined,
    waitMs: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const setValue = VALUE_FLAGS.get(a);
    if (setValue) setValue(opts, argv[++i]);
    else if (a === "--full-page") opts.fullPage = true;
    else if (!a.startsWith("-") && !opts.url) opts.url = a;
    else throw new Error(`unknown argument: ${a}\n${USAGE}`);
  }

  if (!opts.url) throw new Error(`a URL is required\n${USAGE}`);
  return opts;
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

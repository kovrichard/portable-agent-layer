/**
 * `pal cli update`: the version jump, the download, then a fresh process that
 * reinstalls and continues the same rail.
 */

import type { UpdateCache, UpdateChannel } from "../hooks/handlers/update-check";
import { palPkg } from "../hooks/lib/paths";
import { type Captured, runCaptured } from "./install-flow";
import { type Done, LiveRail } from "./ui/live";
import { mark, railGap, railTop } from "./ui/rail";
import { createStyle, type Style } from "./ui/style";

const PACKAGE = "portable-agent-layer";

function upToDate(style: Style, version: string): string {
  if (!style.term.rich) return `Already up to date: PAL ${version} is the latest`;
  const checked = `${style.glyph.dot} checked just now`;
  return `  ${mark(style, "ok")} ${style.gradient("PAL")} ${style.bold(version)} ${style.soft("is the latest")} ${style.dim(checked)}`;
}

function versionJump(style: Style, from: string, to: string): string {
  if (!style.term.rich) return `PAL ${from} -> ${to}`;
  const arrow = style.dim(style.glyph.arrow);
  const pal = `${style.glyph.ask} PAL`;
  return `  ${style.gradient(pal)}  ${style.soft(from)} ${arrow} ${style.bold(style.gradient(to))}`;
}

type Run = (cmd: string, args: string[], cwd?: string) => Promise<Captured>;

export interface UpdateSteps {
  check: () => Promise<UpdateCache>;
  reinstall: (env: Record<string, string>) => number;
  run?: Run;
  switched?: (update: UpdateCache) => string | null;
}

export const CANARY_NEEDS_PACKAGE =
  "--canary installs from npm. A repo install follows its git checkout: check out the canary branch there instead.";

export const ONE_CHANNEL = "Pass --canary or --stable, not both.";

/** Null when both flags are given; without either, the update stays on the current channel. */
export function requestedChannel(
  flags: { canary?: boolean; stable?: boolean },
  current: UpdateChannel
): UpdateChannel | null {
  if (flags.canary && flags.stable) return null;
  if (flags.canary) return "canary";
  if (flags.stable) return "stable";
  return current;
}

const isOlder = (latest: string, current: string) =>
  Bun.semver.order(latest, current) === -1;

function switchedText(to: UpdateChannel, update: UpdateCache): string {
  if (to === "canary")
    return "Switched to the canary channel: plain updates and auto-update now install prereleases";
  if (isOlder(update.latest, update.current))
    return `Switched to the stable channel, but stable ${update.latest} is older than ${update.current} — staying on this version until a stable release catches up`;
  return "Switched to the stable channel: plain updates and auto-update now install stable releases only";
}

/** The one line a channel switch prints; null when the channel did not change. */
export function channelSwitchLine(
  style: Style,
  from: UpdateChannel,
  to: UpdateChannel,
  update: UpdateCache
): string | null {
  if (from === to) return null;
  const back = `pal cli update --${from}`;
  const text = switchedText(to, update);
  if (!style.term.rich) return `warn ${text} -> ${back} to go back`;
  return `  ${mark(style, "warn")} ${text} ${style.dim(style.glyph.arrow)} ${style.cmd(back)} ${style.soft("to go back")}`;
}

/** `bun update -g` keeps the caret range, and on 0.x a caret allows only patch bumps. */
export function downloadCommand(
  update: UpdateCache
): [string, string[], string | undefined] {
  return update.mode === "repo"
    ? ["git", ["pull", "--ff-only"], palPkg()]
    : ["bun", ["add", "-g", `${PACKAGE}@${update.latest}`], undefined];
}

class DownloadFailed extends Error {
  constructor(
    update: UpdateCache,
    readonly output: string
  ) {
    super(
      update.mode === "repo"
        ? "git pull failed — local changes? Pull manually"
        : `try: bun add -g ${PACKAGE}@${update.latest}`
    );
  }
}

async function download(update: UpdateCache, run: Run): Promise<Done> {
  const [cmd, args, cwd] = downloadCommand(update);
  const result = await run(cmd, args, cwd);
  if (result.code !== 0) throw new DownloadFailed(update, result.output);
  return { detail: [`${PACKAGE} ${update.latest}`] };
}

async function downloaded(rail: LiveRail, style: Style, update: UpdateCache, run: Run) {
  try {
    await rail.step("Download", "downloading…", () => download(update, run));
    return true;
  } catch (error) {
    if (!(error instanceof DownloadFailed)) throw error;
    for (const line of error.output.trim().split("\n").slice(-6))
      rail.line(style.dim(`   ${line}`));
    return false;
  }
}

/** Exit code for the parent; the reinstall runs in a fresh process that reads PAL_UPDATED_FROM. */
export async function runUpdate(
  { check, reinstall, run = runCaptured, switched }: UpdateSteps,
  style: Style = createStyle(),
  rail: LiveRail = new LiveRail(style)
): Promise<number> {
  const update = await check();
  rail.line();
  const switchLine = switched?.(update);
  if (switchLine) rail.line(switchLine);
  if (!update.available) {
    rail.line(upToDate(style, update.current));
    rail.line();
    return 0;
  }
  rail.line(versionJump(style, update.current, update.latest));
  rail.line();
  if (style.term.rich) {
    rail.line(railTop(style, "Updating"));
    rail.line(railGap(style));
  }
  if (!(await downloaded(rail, style, update, run))) return 1;
  return reinstall({ PAL_UPDATED_FROM: update.current });
}

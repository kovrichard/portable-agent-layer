/**
 * `pal cli update`: the version jump, the download, then a fresh process that
 * reinstalls and continues the same rail.
 */

import type { UpdateCache } from "../hooks/handlers/update-check";
import { palPkg } from "../hooks/lib/paths";
import { type Captured, runCaptured } from "./install-flow";
import { type Done, LiveRail } from "./ui/live";
import { mark, railGap, railTop } from "./ui/rail";
import { createStyle, type Style } from "./ui/style";

const PACKAGE = "portable-agent-layer";

function upToDate(style: Style, version: string): string {
  if (!style.term.rich) return `PAL ${version} is the latest`;
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
  { check, reinstall, run = runCaptured }: UpdateSteps,
  style: Style = createStyle(),
  rail: LiveRail = new LiveRail(style)
): Promise<number> {
  const update = await check();
  rail.line();
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

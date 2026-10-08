/**
 * `pal cli init`, `install` and the reinstall that ends `update`: one rail of
 * steps, each settling into a line that says what it did, then the doctor's verdict.
 */

import { spawn } from "node:child_process";
import { AGENT_REGISTRY, type AgentName } from "../hooks/lib/agent-registry";
import { palHome, palPkg } from "../hooks/lib/paths";
import { raw as readSettings } from "../hooks/lib/settings";
import { capturingLog, type LogLevel, narrateSteps } from "../targets/lib";
import { agentInventory, detectAgents } from "./doctor/agents";
import {
  type DoctorReport,
  doctorExitCode,
  plainProblemLines,
  plainSummary,
  problemLines,
  tally,
} from "./doctor/render";
import { doctorReport } from "./doctor/run";
import { banner } from "./ui/banner";
import { type Done, LiveRail, type Note } from "./ui/live";
import { box, healthBadge, mark, railEnd, railGap, railNote, railTop } from "./ui/rail";
import { createStyle, homeShortened, PALETTE, type Style } from "./ui/style";
import { whatsNew } from "./whats-new";

type InstallKind = "init" | "install" | "update";

export interface InstallPlan {
  kind: InstallKind;
  agents: AgentName[];
  installers: Record<AgentName, () => Promise<unknown>>;
  verbose: boolean;
  version: string;
  updatedFrom?: string;
  prepareHome?: () => Promise<void>;
}

export interface Captured {
  code: number;
  output: string;
}

export function runCaptured(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<Captured> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd, shell: true });
    let output = "";
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", (error) => done({ code: 1, output: error.message }));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

function lastLines(output: string, count = 4): Note[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-count)
    .map((text) => ({ level: "info", text }));
}

const labelOf = (agent: AgentName) => AGENT_REGISTRY[agent].label;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function openRail(rail: LiveRail, style: Style, plan: InstallPlan): void {
  if (plan.kind === "update") return;
  if (!style.term.rich) {
    rail.line(`PAL ${plan.version} ${plan.kind}`);
    return;
  }
  for (const line of banner(style, plan.version)) rail.line(line);
  const title =
    plan.kind === "init"
      ? "Setting up PAL"
      : `Installing into ${plural(plan.agents.length, "agent")}`;
  rail.line(railTop(style, title));
  rail.line(railGap(style));
  if (plan.kind !== "init") return;
  const found = plan.agents.map(labelOf).join(` ${style.glyph.dot} `);
  rail.line(
    `${mark(style, "info")}  Found ${plural(plan.agents.length, "agent")}  ${style.soft(found)}`
  );
  rail.line(railGap(style));
}

async function installDependencies(): Promise<Done | null> {
  const { dependencyInstall } = await import("./dependencies");
  const { isRepoMode } = await import("../hooks/handlers/update-check");
  const args = dependencyInstall(palPkg(), isRepoMode());
  if (!args) return null;
  const run = await runCaptured("bun", args, palPkg());
  if (run.code === 0)
    return /no changes/.test(run.output) ? null : { detail: ["installed"] };
  return {
    detail: ["bun install failed"],
    notes: [
      { level: "warn", text: "continuing anyway, but hooks may not work" },
      ...lastLines(run.output),
    ],
  };
}

async function applyMigrations(): Promise<Done | null> {
  const { applyPendingMigrations } = await import("./migrate");
  const lines = applyPendingMigrations();
  if (lines.length === 0) return null;
  return {
    detail: [`${plural(lines.length, "change")} applied`],
    notes: lines.map((text) => ({ level: "info", text })),
  };
}

async function downloadChromium(): Promise<Done | null> {
  if (process.env.PAL_SKIP_BROWSER_INSTALL === "1") return null;
  const { installChromium } = await import("./doctor/environment");
  const installed = await installChromium();
  if (installed === null) return null;
  return { detail: [installed ? "installed for screenshots" : "download failed"] };
}

async function askSetupQuestions(): Promise<boolean> {
  const { scaffoldTelos, scaffoldPalSettings } = await import("../targets/lib");
  const { promptIdentity } = await import("./setup-identity");
  const { promptAttribution } = await import("./setup-attribution");
  const { promptAutoUpdate } = await import("./setup-auto-update");
  scaffoldTelos();
  scaffoldPalSettings();
  const asked = [
    await promptIdentity(),
    await promptAttribution(),
    await promptAutoUpdate(),
  ];
  const { ensureActorRegistered } = await import("../hooks/lib/actor");
  ensureActorRegistered();
  return asked.some(Boolean);
}

function noteFor(level: LogLevel, message: string, verbose: boolean): Note | null {
  const text = homeShortened(message);
  if (level === "warn") return { level: "warn", text };
  if (level === "error") return { level: "fail", text };
  return verbose ? { level: "info", text } : null;
}

async function runInstaller(plan: InstallPlan, agent: AgentName, notes: Note[]) {
  await capturingLog((level, message) => {
    const note = noteFor(level, message, plan.verbose);
    if (note) notes.push(note);
  }, plan.installers[agent]);
}

async function installOne(plan: InstallPlan, agent: AgentName): Promise<Done> {
  const notes: Note[] = [];
  await runInstaller(plan, agent, notes);
  return { detail: agentInventory(agent), notes };
}

async function installAll(plan: InstallPlan): Promise<Done> {
  const notes: Note[] = [];
  for (const agent of plan.agents) await runInstaller(plan, agent, notes);
  return { detail: plan.agents, notes };
}

async function prepareShared(): Promise<number> {
  const { copyPalDocs } = await import("../targets/lib");
  const { regenerateIfNeeded } = await import("../hooks/lib/claude-md");
  const docs = copyPalDocs();
  regenerateIfNeeded();
  return docs;
}

async function finishShared(docs: number): Promise<Done> {
  const { generateSkillIndex } = await import("../targets/lib");
  const { writeContextDigests } = await import("../hooks/handlers/context-digests");
  const skills = generateSkillIndex();
  writeContextDigests();
  return {
    detail: [`${plural(skills, "skill")} indexed`, plural(docs, "doc"), "digests"],
  };
}

/**
 * A published install carries the page in its tarball; a checkout does not —
 * ui/dist is gitignored, so a pull leaves whatever was built last. Rebuild
 * there, then replace the process, because the API is the running code.
 */
async function refreshControlRoom(): Promise<Done | null> {
  const { isRepoMode } = await import("../hooks/handlers/update-check");
  const { buildPage } = await import("../tools/control-room/static");
  const rebuilt = isRepoMode() ? buildPage() : null;
  if (rebuilt === false)
    return {
      detail: ["page not rebuilt"],
      notes: [{ level: "warn", text: "run: bun run build:ui" }],
    };
  const { restartIfRunning } = await import("./server");
  const restarted = await restartIfRunning();
  const detail = [rebuilt ? "page rebuilt" : "", restarted ? "restarted" : ""].filter(
    Boolean
  );
  return detail.length > 0 ? { detail } : null;
}

function truncated(text: string, width: number): string {
  return [...text].length <= width ? text : `${[...text].slice(0, width - 1).join("")}…`;
}

export function notesLink(url: string, more: number, width: number): [string, string] {
  const label = more > 0 ? `${more} more:` : "all notes:";
  const room = width - label.length - 3;
  const short =
    url.length <= room ? url : url.replace(/github\.com\/[^/]+\/[^/]+/, "github.com/…");
  return [label, short];
}

async function showWhatsNew(rail: LiveRail, style: Style, from: string, to: string) {
  const news = await whatsNew(from, to);
  if (!news) return;
  const width = Math.max(30, style.term.width - 6);
  if (!style.term.rich) {
    for (const item of news.items) rail.line(`new  ${item}`);
    rail.line(`notes ${news.url}`);
    return;
  }
  const [label, url] = notesLink(news.url, news.more, width);
  rail.line(railGap(style));
  const heading = `What's new in ${to.replace(/\.0$/, "")}`;
  rail.line(`${mark(style, "info")}  ${style.bold(heading)}`);
  for (const item of news.items)
    rail.line(
      railNote(
        style,
        `${style.paint(PALETTE.violet, style.glyph.sparkle)} ${truncated(item, width)}`
      )
    );
  const lead = style.dim(`${style.glyph.arrow} ${label}`);
  rail.line(railNote(style, `${lead} ${style.cmd(url)}`));
}

function closeRail(rail: LiveRail, style: Style, report: DoctorReport | null): void {
  if (!report) {
    rail.line(style.term.rich ? railEnd(style, style.soft("Installed")) : "installed");
    return;
  }
  const t = tally(report.findings);
  if (!style.term.rich) {
    for (const line of [...plainProblemLines(t), plainSummary(t)]) rail.line(line);
    return;
  }
  const count = { fails: t.fails.length, warns: t.warns.length };
  rail.line(railGap(style));
  const passedCount = style.soft(`${plural(t.passes.length, "check")} passed`);
  rail.line(railEnd(style, `${healthBadge(style, count)}  ${passedCount}`));
  const problems = problemLines(style, t, "   ");
  rail.line();
  for (const line of problems) rail.line(line);
  if (problems.length > 0) rail.line();
}

function showNextSteps(rail: LiveRail, style: Style): void {
  const who = readSettings().identity;
  const name = who?.principal?.name ? `, ${who.principal.name}` : "";
  const ai = who?.ai?.name || "PAL";
  if (!style.term.rich) {
    rail.line(
      `Next: run pal to start your agent, ask it to "onboard me", run pal cli doctor anytime`
    );
    return;
  }
  const step = (n: string, command: string, what: string) =>
    `${style.dim(n)}  ${style.cmd(command.padEnd(17))}${style.soft(what)}`;
  const lines = box(style, [
    "",
    style.bold(style.gradient(`You're set${name}. ${ai} is ready.`)),
    "",
    step("1", "pal", "start your agent"),
    step("2", '"onboard me"', "teach it your goals"),
    step("3", "pal cli doctor", "check health anytime"),
    "",
  ]);
  for (const line of lines) rail.line(line);
  rail.line();
}

async function installAgents(rail: LiveRail, plan: InstallPlan): Promise<void> {
  if (plan.kind === "update") {
    await rail.step("Reinstall", "reinstalling…", () => installAll(plan));
    return;
  }
  for (const agent of plan.agents)
    await rail.step(labelOf(agent), "installing…", () => installOne(plan, agent));
}

export async function runInstall(plan: InstallPlan): Promise<number> {
  narrateSteps(plan.verbose);
  const style = createStyle();
  const rail = new LiveRail(style);
  openRail(rail, style, plan);
  const prepareHome = plan.prepareHome;
  if (prepareHome)
    await rail.step("PAL home", "creating…", async () => {
      await prepareHome();
      return { detail: [homeShortened(palHome()), "TELOS scaffolded"] };
    });
  await rail.step("Dependencies", "installing…", installDependencies);
  await rail.step("Migrations", "applying…", applyMigrations);
  await rail.step("Chromium", "downloading the browser…", downloadChromium);
  if ((await askSetupQuestions()) && style.term.rich) rail.line(railGap(style));
  const docs = await prepareShared();
  await installAgents(rail, plan);
  await rail.step("Shared", "indexing…", () => finishShared(docs));
  await rail.step("Control room", "refreshing…", refreshControlRoom);
  const report =
    process.env.PAL_SKIP_DOCTOR === "1" ? null : doctorReport(detectAgents());
  if (plan.updatedFrom) await showWhatsNew(rail, style, plan.updatedFrom, plan.version);
  closeRail(rail, style, report);
  if (plan.kind === "init") showNextSteps(rail, style);
  return report ? doctorExitCode(report.findings) : 0;
}

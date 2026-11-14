import type {
  EngineInterface as Dollar,
  Elements,
  Register,
  RenderInput,
} from "claude-code";
import { atom, read, update } from "claude-code";

import type { Draft, Isc, Review } from "../types";

const PANE = "pal-review";
const TITLE = "PAL review";
const SHOWN_DRAFTS = 5;
const SHOWN_ISCS = 8;

const EMPTY: Review = { project: null, drafts: [], iscs: [], notice: "" };
const review = atom({ plugin: "pal-review", key: "review" } as const, EMPTY, {
  shape: "review-1",
});

type Run = (
  argv: readonly string[]
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
type Project = { name: string; path?: string };
type Ui = Pick<Elements["mobile"], "Box" | "Text" | "Button">;

async function palJson<T>(run: Run, args: string[]): Promise<T> {
  const { exitCode, stdout, stderr } = await run(["pal", "cli", ...args]);
  const command = `pal cli ${args.join(" ")}`;

  if (exitCode !== 0) throw new Error(stderr.trim() || `${command} exited ${exitCode}`);

  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`${command} did not print JSON`);
  }
}

export function projectForCwd(projects: Project[], cwd: string): string | null {
  const owning = projects.filter(
    (p) => p.path && (cwd === p.path || cwd.startsWith(`${p.path}/`))
  );
  const deepest = owning.sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0];

  return deepest?.name ?? null;
}

export function toDrafts(
  rules: { id: string; status: string; when: string; steering: string }[]
): Draft[] {
  return rules
    .filter((r) => r.status === "draft")
    .map(({ id, when, steering }) => ({ id, when, steering }));
}

export function toIscs(iscs: { id: number; text: string; status: string }[]): Isc[] {
  return iscs
    .filter((i) => i.status === "open")
    .map((i) => ({ id: i.id, title: i.text.split("\n")[0] ?? "" }));
}

function cut(text: string, columns: number): string {
  return text.length <= columns ? text : `${text.slice(0, Math.max(1, columns - 1))}…`;
}

async function loadReview(run: Run, cwd: string, notice: string): Promise<Review> {
  const rules = await palJson<Parameters<typeof toDrafts>[0]>(run, [
    "rule",
    "list",
    "--json",
  ]);
  const { projects } = await palJson<{ projects: Project[] }>(run, ["project", "list"]);
  const project = projectForCwd(projects, cwd);
  const iscs = project
    ? toIscs(
        (
          await palJson<{ iscs: Parameters<typeof toIscs>[0] }>(run, [
            "project",
            "list-isc",
            project,
          ])
        ).iscs
      )
    : [];

  return { project, drafts: toDrafts(rules), iscs, notice };
}

async function isPaneUp($: Dollar): Promise<boolean> {
  return (await $.ui.panes()).some((pane) => pane.id === PANE);
}

async function refresh($: Dollar, notice = "") {
  try {
    const next = await loadReview(
      (argv) => $.process.run(argv),
      await $.session.cwd(),
      notice
    );
    await update($, review, () => next);
  } catch (error) {
    await update($, review, (current) => ({
      ...current,
      notice: `Could not read PAL: ${String(error)}`,
    }));
  }
}

async function act($: Dollar, args: string[], done: string) {
  const { exitCode, stderr } = await $.process.run(["pal", "cli", ...args]);
  await refresh(
    $,
    exitCode === 0 ? done : `pal cli ${args.join(" ")} failed: ${stderr.trim()}`
  );
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const started = await next(e);
    await $.command.register({
      name: "pal-review",
      description: "Approve or deny PAL rule drafts and close open ISCs in a pane",
    });

    return started;
  });

  on("command.run", { command: "pal-review" }, async ($) => {
    await refresh($);
    await $.ui.open({ id: PANE, title: TITLE });
    const { drafts, iscs, project } = await read($, review);
    const where = project ? ` in ${project}` : "";

    return {
      text: `PAL review: ${drafts.length} rule drafts, ${iscs.length} open ISCs${where}.`,
    };
  });

  on("turn.complete", async ($, e, next) => {
    const ended = await next(e);

    if (await isPaneUp($)) await refresh($);

    return ended;
  }).catch(($, e, next) => next(e));

  on("ui.render", { component: "Pane", requestId: PANE }, drawPane);
};

async function drawPane($: Dollar, e: RenderInput<"Pane">) {
  const ui: Ui = $.ui.resolve(e);
  const { project, drafts, iscs, notice } = await read($, review);
  const width = Math.max(20, e.props.bodyColumns - 2);

  if (e.props.placement === "widget") {
    return (
      <ui.Text>
        {drafts.length} drafts · {iscs.length} open ISCs
      </ui.Text>
    );
  }

  return (
    <ui.Box flexDirection="column" gap={1}>
      {notice !== "" && <ui.Text dimColor>{cut(notice, width)}</ui.Text>}
      {draftSection($, ui, drafts, width)}
      {iscSection($, ui, project, iscs, width)}
      <ui.Button key="refresh" onPress={() => void refresh($)}>
        Refresh
      </ui.Button>
    </ui.Box>
  );
}

function draftSection($: Dollar, ui: Ui, drafts: Draft[], width: number) {
  return (
    <ui.Box flexDirection="column">
      <ui.Text bold>Rule drafts ({drafts.length})</ui.Text>
      {drafts.length === 0 && <ui.Text dimColor>Nothing waiting.</ui.Text>}
      {drafts.slice(0, SHOWN_DRAFTS).map((d) => (
        <ui.Box key={`draft-${d.id}`} flexDirection="column">
          <ui.Text>{cut(d.when, width)}</ui.Text>
          <ui.Text dimColor>{cut(d.steering, width)}</ui.Text>
          <ui.Box flexDirection="row" gap={1}>
            <ui.Button
              key={`approve-${d.id}`}
              variant="primary"
              onPress={() => void act($, ["rule", "approve", d.id], `Approved ${d.id}.`)}
            >
              Approve
            </ui.Button>
            <ui.Button
              key={`deny-${d.id}`}
              onPress={() => void act($, ["rule", "deny", d.id], `Denied ${d.id}.`)}
            >
              Deny
            </ui.Button>
          </ui.Box>
        </ui.Box>
      ))}
      {drafts.length > SHOWN_DRAFTS && (
        <ui.Text dimColor>{drafts.length - SHOWN_DRAFTS} more after these</ui.Text>
      )}
    </ui.Box>
  );
}

function iscSection(
  $: Dollar,
  ui: Ui,
  project: string | null,
  iscs: Isc[],
  width: number
) {
  const complete = (id: number) =>
    void act(
      $,
      ["project", "complete-isc", project ?? "", String(id)],
      `ISC-${id} done.`
    );

  return (
    <ui.Box flexDirection="column">
      <ui.Text bold>
        Open ISCs{project ? ` · ${project}` : ""} ({iscs.length})
      </ui.Text>
      {!project && <ui.Text dimColor>No PAL project owns this folder.</ui.Text>}
      {iscs.slice(0, SHOWN_ISCS).map((i) => (
        <ui.Box key={`isc-${i.id}`} flexDirection="row" gap={1}>
          <ui.Button key={`done-${i.id}`} onPress={() => complete(i.id)}>
            Done
          </ui.Button>
          <ui.Text>{cut(`ISC-${i.id} ${i.title}`, width - 10)}</ui.Text>
        </ui.Box>
      ))}
      {iscs.length > SHOWN_ISCS && (
        <ui.Text dimColor>{iscs.length - SHOWN_ISCS} more after these</ui.Text>
      )}
    </ui.Box>
  );
}

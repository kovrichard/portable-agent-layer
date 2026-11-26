import { expect, test } from "claude-code/testing";

const PANE = {
  plugin: "pal-review",
  component: "Pane",
  requestId: "pal-review",
  props: {
    title: "PAL review",
    isFocused: false,
    bodyColumns: 60,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const;

const TYPED = {
  command: "pal-review",
  args: "",
  origin: { kind: "composer" },
  presentation: { isFullscreen: false, columns: 120 },
} as const;

const RULES = [
  {
    id: "r1",
    status: "draft",
    when: "The user asks why",
    steering: "Name the cause first.",
  },
  { id: "r2", status: "approved", when: "Already approved", steering: "x" },
];
const PROJECTS = {
  projects: [
    { name: "pal", path: "/repo" },
    { name: "other", path: "/elsewhere" },
  ],
};
const ISCS = { iscs: [{ id: 7, text: "Ship the pane\nlong body", status: "open" }] };

function answerFor(argv: readonly string[]): string {
  const command = argv.slice(2, 4).join(" ");

  if (command === "rule list") return JSON.stringify(RULES);

  if (command === "project list") return JSON.stringify(PROJECTS);

  if (command === "project list-isc") return JSON.stringify(ISCS);

  return "";
}

test("the pane lists drafts and ISCs, and Approve runs pal cli rule approve", async ($, on) => {
  const ran: string[] = [];
  on("process.run", (_, e) => {
    ran.push(e.argv.join(" "));
    const stdout = answerFor(e.argv);

    return {
      value: {
        exitCode: 0,
        stdout,
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on("session.cwd", () => ({ value: "/repo/src" }));
  on("ui.open", () => ({ value: { isPlaced: true } }));

  const reply = await $.command.run(TYPED);
  expect(reply).toEqual(
    expect.objectContaining({ text: "PAL review: 1 rule drafts, 1 open ISCs in pal." })
  );

  for (const surface of ["desktop", "terminal"] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect((await ui.find({ type: "Text", text: /Name the cause/ }))?.text).toBe(
      "Name the cause first."
    );
    expect((await ui.find({ type: "Text", text: /ISC-7/ }))?.text).toBe(
      "ISC-7 Ship the pane"
    );
    expect(await ui.find({ type: "Text", text: /Already approved/ })).toBe(undefined);
    await ui.unmount();
  }

  const ui = await $.ui.mount({ ...PANE, surface: "desktop" });
  await ui.press({ key: "approve-r1" });
  await ui.press({ key: "done-7" });
  expect(ran).toContain("pal cli rule approve r1");
  expect(ran).toContain("pal cli project complete-isc pal 7");
  await ui.unmount();
});

test("a folder no project owns shows drafts and says so", async ($, on) => {
  on("process.run", (_, e) => ({
    value: {
      exitCode: 0,
      stdout: answerFor(e.argv),
      stderr: "",
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }));
  on("session.cwd", () => ({ value: "/tmp" }));
  on("ui.open", () => ({ value: { isPlaced: true } }));

  await $.command.run(TYPED);
  const ui = await $.ui.mount({ ...PANE, surface: "desktop" });
  expect((await ui.find({ type: "Text", text: /No PAL project/ }))?.text).toBe(
    "No PAL project owns this folder."
  );
  await ui.unmount();
});

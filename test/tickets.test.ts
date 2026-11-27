import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readProject, saveProjectTickets, writeProject } from "../src/progress/projects";
import {
  importedTicketId,
  pendingImports,
  renderTickets,
  replayTickets,
  serializeTicket,
  type TicketState,
  ticketChanges,
  withoutTickets,
} from "../src/progress/tickets";
import { fakeProject, projectsHome } from "./lib/projects-lib-fixture";

const home = projectsHome(import.meta.file);
const NOON = new Date("2026-11-27T12:00:00.000Z");
const none = { criteria: "", changelog: "" };

const logOf = (...states: TicketState[]) => states.map(serializeTicket).join("\n");

const opened = (ticket: string, text: string, at: string): TicketState => ({
  at,
  ticket,
  status: "open",
  text,
  since: at,
});

describe("replay", () => {
  const first = opened("k7m2", "ship it", "2026-11-27T10:00:00.000Z");
  const closed: TicketState = {
    ...first,
    at: "2026-11-27T11:00:00.000Z",
    status: "done",
    since: "2026-11-27T11:00:00.000Z",
  };

  test("keeps the newest state of a ticket wherever its line sits", () => {
    expect(replayTickets(logOf(first, closed))).toEqual([closed]);
    expect(replayTickets(logOf(closed, first))).toEqual([closed]);
  });

  test("two states stamped alike resolve the same in either order", () => {
    const rival = { ...closed, text: "ship it today" };

    expect(replayTickets(logOf(closed, rival))).toEqual(
      replayTickets(logOf(rival, closed))
    );
  });

  test("an imported state, which carries no time, loses to any change", () => {
    const imported: TicketState = { ticket: "1", status: "open", text: "old", was: "1" };
    const edited = { ...imported, at: "2026-01-01T00:00:00.000Z", text: "new" };

    expect(replayTickets(logOf(edited, imported))).toEqual([edited]);
  });

  test("skips a line cut short or not a ticket", () => {
    const log = `${logOf(first)}\n{"ticket":"zz","status":"open"\n{"ticket":"q","status":"lost","text":"x"}`;

    expect(replayTickets(log)).toEqual([first]);
  });
});

describe("render", () => {
  test("lists open tickets in the order they opened, after the ISA's own text", () => {
    const later = opened("b222", "second", "2026-11-27T11:00:00.000Z");
    const earlier = opened("a111", "first", "2026-11-27T10:00:00.000Z");

    expect(
      renderTickets([later, earlier], { criteria: "Intro.", changelog: "" })
    ).toEqual({
      criteria: "Intro.\n\n- [ ] ISC-a111: first\n- [ ] ISC-b222: second",
      changelog: "",
    });
  });

  test("files closed tickets under one heading per kind and day", () => {
    const done = (
      ticket: string,
      since: string,
      status: TicketState["status"] = "done"
    ) => ({
      ticket,
      status,
      text: ticket,
      since,
    });
    const rendered = renderTickets(
      [
        done("c", "2026-11-02T09:00:00.000Z"),
        done("r", "2026-11-01T12:00:00.000Z", "retired"),
        done("a", "2026-11-01T08:00:00.000Z"),
        done("b", "2026-11-01T18:00:00.000Z"),
      ],
      none
    );

    expect(rendered.changelog).toBe(
      [
        "### Archived 2026-11-01\n- [x] ISC-a: a\n- [x] ISC-b: b",
        "### Retired 2026-11-01\n- [~] ISC-r: r",
        "### Archived 2026-11-02\n- [x] ISC-c: c",
      ].join("\n\n")
    );
  });

  test("imported tickets of one day keep their old numbering", () => {
    const imported = (ticket: string, was: string): TicketState => ({
      ticket,
      status: "done",
      text: was,
      since: "2026-08-08",
      was,
    });

    expect(
      renderTickets([imported("zzzz", "10"), imported("aaaa", "9")], none).changelog
    ).toBe("### Archived 2026-08-08\n- [x] ISC-aaaa: 9\n- [x] ISC-zzzz: 10");
  });

  test("takes ticket lines and archive headings out of a section, keeping the rest", () => {
    expect(
      withoutTickets("Notes.\n\n### Archived 2026-01-01\n- [x] ISC-1: done\n\nMore.")
    ).toBe("Notes.\n\nMore.");
  });
});

describe("changes", () => {
  const open = opened("k7m2", "ship it", "2026-11-27T10:00:00.000Z");

  test("a ticket that reads as it is logged needs nothing appended", () => {
    expect(
      ticketChanges([open], { criteria: "- [ ] ISC-k7m2: ship it", changelog: "" }, NOON)
    ).toEqual([]);
  });

  test("an edit keeps the ticket's place, a close moves it to now", () => {
    const edited = { criteria: "- [ ] ISC-k7m2: ship it now", changelog: "" };
    const closed = {
      criteria: "",
      changelog: "### Archived 2026-11-27\n- [x] ISC-k7m2: ship it",
    };

    expect(ticketChanges([open], edited, NOON)).toEqual([
      { ...open, at: NOON.toISOString(), text: "ship it now" },
    ]);
    expect(ticketChanges([open], closed, NOON)).toEqual([
      { ...open, at: NOON.toISOString(), status: "done", since: NOON.toISOString() },
    ]);
  });

  test("a closed ticket new to the log keeps the day of its heading", () => {
    const [change] = ticketChanges(
      [],
      { criteria: "", changelog: "### Retired 2026-02-03\n- [~] ISC-5: gone" },
      NOON
    );

    expect(change).toMatchObject({ ticket: "5", status: "retired", since: "2026-02-03" });
  });

  test("a ticket left out of the sections is left as it is", () => {
    expect(ticketChanges([open], none, NOON)).toEqual([]);
  });

  test("a second change in the same millisecond still outranks the first", () => {
    const stampedNow = { ...open, at: NOON.toISOString() };
    const [change] = ticketChanges(
      [stampedNow],
      { criteria: "- [ ] ISC-k7m2: again", changelog: "" },
      NOON
    );

    expect(change?.at).toBe("2026-11-27T12:00:00.001Z");
  });
});

describe("two machines", () => {
  test("tickets opened and closed on each between syncs all survive the merge", () => {
    const shared = opened("k7m2", "ship it", "2026-11-27T09:00:00.000Z");
    const onA = ticketChanges(
      [shared],
      { criteria: "", changelog: "### Archived 2026-11-27\n- [x] ISC-k7m2: ship it" },
      new Date("2026-11-27T10:00:00.000Z")
    );
    const onB = ticketChanges(
      [shared],
      { criteria: "- [ ] ISC-k7m2: ship it\n- [ ] ISC-q9w3: test it", changelog: "" },
      new Date("2026-11-27T10:30:00.000Z")
    );
    const merged = (first: TicketState[], second: TicketState[]) =>
      renderTickets(replayTickets(logOf(shared, ...first, ...second)), none);

    expect(merged(onA, onB)).toEqual(merged(onB, onA));
    expect(merged(onA, onB)).toEqual({
      criteria: "- [ ] ISC-q9w3: test it",
      changelog: "### Archived 2026-11-27\n- [x] ISC-k7m2: ship it",
    });
  });
});

describe("a project's tickets", () => {
  const isa = () => resolve(home, "work", "projects", "demo", "ISA.md");
  const log = () => resolve(home, "work", "projects", "demo", "tickets.jsonl");

  test("live in their log, and a ticket change leaves ISA.md byte for byte", () => {
    writeProject(fakeProject({ goal: "Ship.", criteria: "- [ ] ISC-k7m2: ship it" }));
    const before = readFileSync(isa(), "utf-8");
    const p = readProject("demo");
    if (!p) throw new Error("demo missing");
    p.criteria = "";
    p.changelog = "### Archived 2026-11-27\n- [x] ISC-k7m2: ship it";
    saveProjectTickets(p, NOON);

    expect(before).not.toContain("ISC-");
    expect(readFileSync(isa(), "utf-8")).toBe(before);
    expect(readProject("demo")).toMatchObject({
      goal: "Ship.",
      changelog: "### Archived 2026-11-27\n- [x] ISC-k7m2: ship it",
      updated: NOON.toISOString(),
    });
  });

  test("still in an old ISA.md are imported into the log by the first ticket change", () => {
    writeProject(fakeProject());
    const legacy = `${readFileSync(isa(), "utf-8")}\n## Criteria\n\n- [ ] ISC-1: old\n`;
    writeFileSync(isa(), legacy);
    const p = readProject("demo");
    if (!p) throw new Error("demo missing");
    const [imported] = p.oldIscNumbers?.["1"] ?? [];
    p.criteria = `${p.criteria}\n- [ ] ISC-k7m2: new`;
    saveProjectTickets(p, NOON);

    expect(readFileSync(isa(), "utf-8")).toBe(legacy);
    expect(readFileSync(log(), "utf-8").trim().split("\n")).toEqual([
      serializeTicket({
        ticket: imported as string,
        status: "open",
        text: "old",
        was: "1",
      }),
      serializeTicket(opened("k7m2", "new", NOON.toISOString())),
    ]);
    expect(readProject("demo")?.criteria).toBe(
      `- [ ] ISC-${imported}: old\n- [ ] ISC-k7m2: new`
    );
  });
});

describe("importing old numbered tickets", () => {
  const owner = { name: "pal", created: "2026-03-01T00:00:00.000Z" };

  test("gives one old ticket the same six-character id anywhere", () => {
    const id = importedTicketId("pal", "151", "ship it");

    expect(id).toMatch(/^[0-9a-z]{6}$/);
    expect(id).not.toMatch(/^\d+$/);
    expect(importedTicketId("pal", "151", "ship it")).toBe(id);
    expect(importedTicketId("pal", "151", "ship it now")).not.toBe(id);
    expect(importedTicketId("other", "151", "ship it")).not.toBe(id);
  });

  test("two machines' imports merge: shared tickets once, one number's two tasks apart, a close wins", () => {
    const onA = {
      criteria: "- [ ] ISC-1: shared\n- [ ] ISC-2: only on A\n- [ ] ISC-3: closed on B",
      changelog: "",
    };
    const onB = {
      criteria: "- [ ] ISC-1: shared\n- [ ] ISC-2: only on B",
      changelog: "### Archived 2026-11-20\n- [x] ISC-3: closed on B",
    };
    const synced = [
      ...new Set([...pendingImports("", owner, onA), ...pendingImports("", owner, onB)]),
    ];
    const tickets = replayTickets(synced.join("\n"));

    expect(synced.filter((line) => line.includes('"shared"'))).toHaveLength(1);
    expect(tickets.map((t) => [t.was, t.text, t.status]).sort()).toEqual([
      ["1", "shared", "open"],
      ["2", "only on A", "open"],
      ["2", "only on B", "open"],
      ["3", "closed on B", "done"],
    ]);
  });

  test("a ticket already imported is not imported again", () => {
    const stored = { criteria: "- [ ] ISC-1: shared", changelog: "" };
    const [line] = pendingImports("", owner, stored);

    expect(pendingImports(`${line}\n`, owner, stored)).toEqual([]);
  });
});

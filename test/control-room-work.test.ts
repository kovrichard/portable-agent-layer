import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  inProgressWork,
  openWork,
  waitingOnUser,
  workOf,
} from "../src/tools/control-room/work";
import { freshTestDir } from "./lib/test-home";
import { seedWorkNode } from "./lib/work-node-fixture";

const NOW = new Date("2026-09-05T12:00:00.000Z");

beforeEach(() => {
  process.env.PAL_HOME = freshTestDir(import.meta.file);
});

function registerProject(slug: string): void {
  const dir = resolve(process.env.PAL_HOME as string, "memory", "projects", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "ISA.md"),
    `---\nname: ${slug}\nstatus: active\ncreated: 2026-08-01T00:00:00.000Z\nupdated: 2026-09-01T00:00:00.000Z\n---\n\n## Goal\n\nnone\n`,
    "utf-8"
  );
}

describe("openWork", () => {
  test("lists every node that is not done, newest first", () => {
    registerProject("demo");
    seedWorkNode("demo", "a", { at: "2026-09-03T00:00:00.000Z", status: "parked" });
    seedWorkNode("demo", "b", { at: "2026-09-04T00:00:00.000Z", stoppedAt: "half way" });
    seedWorkNode("demo", "c", { status: "done" });

    const cards = openWork(NOW);

    expect(cards.map((c) => c.node)).toEqual(["b", "a"]);
    expect(cards[0]).toMatchObject({
      scope: "demo",
      slug: "demo",
      label: "demo",
      title: "title b",
      status: "active",
      stoppedAt: "half way",
      waitingOn: null,
      ageDays: 1,
    });
  });

  test("a folder scope has no slug and is labelled by its folder name", () => {
    seedWorkNode("/work/loose-folder", "a");
    expect(openWork(NOW)[0]).toMatchObject({ slug: null, label: "loose-folder" });
  });

  test("only a waiting node carries what it waits on", () => {
    seedWorkNode("demo", "w", { status: "waiting", waitingOn: "pick a price" });
    seedWorkNode("demo", "p", { status: "parked" });
    expect(waitingOnUser(openWork(NOW)).map((c) => [c.node, c.waitingOn])).toEqual([
      ["w", "pick a price"],
    ]);
  });

  test("in progress means active or waiting, touched within a week", () => {
    seedWorkNode("demo", "fresh", { at: "2026-09-04T00:00:00.000Z" });
    seedWorkNode("demo", "waits", { status: "waiting", at: "2026-09-04T00:00:00.000Z" });
    seedWorkNode("demo", "old", { at: "2026-08-20T00:00:00.000Z" });
    seedWorkNode("demo", "parked", { status: "parked", at: "2026-09-04T00:00:00.000Z" });
    expect(
      inProgressWork(openWork(NOW))
        .map((c) => c.node)
        .sort()
    ).toEqual(["fresh", "waits"]);
  });

  test("workOf keeps one project's cards", () => {
    registerProject("demo");
    registerProject("other");
    seedWorkNode("demo", "a");
    seedWorkNode("other", "b");
    expect(workOf("demo", openWork(NOW)).map((c) => c.node)).toEqual(["a"]);
  });
});

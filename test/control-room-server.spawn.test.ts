import { describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Matrix } from "../src/tools/control-room/matrix";
import { buildPageFirst } from "./lib/built-page";
import {
  controlRoomPerTest,
  getJson,
  listen,
  post,
  registerProject,
} from "./lib/control-room-server-fixture";
import { removeOnceReleased } from "./lib/remove-once-released";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

buildPageFirst();

controlRoomPerTest(import.meta.file);

interface DetailBody {
  iscs: { id: number; status: string }[];
  placed: string | null;
}

describe("what each route answers", () => {
  test("/ is the bundled page, not a template", async () => {
    const base = await listen();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('id="root"');
    expect(html).not.toContain("app.tsx");
  });
});

describe("the relationship tab", () => {
  test("/relationship is the page", async () => {
    const base = await listen();
    const res = await fetch(`${base}/relationship`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });
});

describe("what the page may change", () => {
  const withCriteria =
    "## Criteria\n\n- [ ] ISC-1: the open one\n- [ ] ISC-2: the other\n";

  test("closing an ISC archives it, and reopening walks it back", async () => {
    registerProject("demo", withCriteria);
    const base = await listen();
    const statuses = async () =>
      (await getJson<DetailBody>(`${base}/api/project?slug=demo`)).iscs.map(
        (i) => `${i.id}:${i.status}`
      );

    expect(await statuses()).toEqual(["1:open", "2:open"]);

    expect(
      (await post(base, "/api/isc", { project: "demo", id: 1, status: "done" })).ok
    ).toBe(true);
    expect(await statuses()).toEqual(["2:open", "1:done"]);

    expect(
      (await post(base, "/api/isc", { project: "demo", id: 1, status: "open" })).ok
    ).toBe(true);
    expect(await statuses()).toEqual(["2:open", "1:open"]);
  });

  test("closing one that is already closed changes nothing and says so", async () => {
    registerProject("demo", withCriteria);
    const base = await listen();
    await post(base, "/api/isc", { project: "demo", id: 1, status: "done" });
    const again = await post(base, "/api/isc", {
      project: "demo",
      id: 1,
      status: "done",
    });
    expect(await again.json()).toMatchObject({ changed: false });
  });

  test("a placement overrules the grid's own guess and survives on the record", async () => {
    registerProject("demo", withCriteria);
    const base = await listen();
    const quadrantOf = async () => {
      const grid = await getJson<Matrix>(`${base}/api/matrix`);
      for (const key of ["now", "plan", "noise", "later"] as const) {
        if (grid[key].some((i) => i.id === "demo")) return key;
      }
      return null;
    };

    expect(await quadrantOf()).toBe("later");
    expect(
      (await post(base, "/api/placement", { project: "demo", quadrant: "now" })).ok
    ).toBe(true);
    expect(await quadrantOf()).toBe("now");

    const detail = await getJson<DetailBody>(`${base}/api/project?slug=demo`);
    expect(detail.placed).toBe("now");

    await post(base, "/api/placement", { project: "demo", quadrant: null });
    expect(await quadrantOf()).toBe("later");
  });
});

// The button's own route is pointed at a PAL_PKG that holds no PAL, so the child
// it spawns finds nothing to run. What is under test is the route, not the update.
describe("keeping PAL up to date", () => {
  test("the button answers at once rather than waiting for the update", async () => {
    const prevPkg = process.env.PAL_PKG;
    process.env.PAL_PKG = freshTestDir(import.meta.file);
    const base = await listen();
    try {
      expect((await post(base, "/api/update/run", {})).status).toBe(202);
    } finally {
      removeOnceReleased(process.env.PAL_PKG);
      if (prevPkg === undefined) delete process.env.PAL_PKG;
      else process.env.PAL_PKG = prevPkg;
    }
  });
});

describe("how the page itself is served", () => {
  test("a deep link into the page is served the page, not a 404", async () => {
    const base = await listen();
    for (const path of ["/", "/projects", "/projects/portable-agent-layer", "/log"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    }
  });

  test("the page's own assets are served, and only those", async () => {
    const base = await listen();
    const html = await (await fetch(`${base}/`)).text();
    const asset = /src="(\/assets\/[^"]+)"/.exec(html)?.[1];
    expect(asset).toBeTruthy();

    const served = await fetch(`${base}${asset}`);
    expect(served.status).toBe(200);
    expect(Number(served.headers.get("content-length"))).toBeGreaterThan(0);

    for (const climb of ["/../package.json", "/assets/../../../package.json"]) {
      expect((await fetch(`${base}${climb}`)).status).toBe(404);
    }
  });
});

describe("the one thing the page may change", () => {
  test("an override is written as the user's own answer", async () => {
    registerProject("alpha");
    const base = await listen();
    const res = await post(base, "/api/serves", {
      project: "alpha",
      serves: "revenue",
      note: "a bet",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ project: "alpha", serves: "revenue", by: "user" });

    const grid = await getJson<Matrix>(`${base}/api/matrix`);
    const item = grid.plan.find((i) => i.id === "alpha");
    expect(item?.serves).toBe("revenue");
    expect(item?.servesBy).toBe("user");
    expect(grid.unranked).toBe(0);
  });
});

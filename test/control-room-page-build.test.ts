import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ABANDONED_LOCK_MS,
  buildPage,
  isUpToDate,
  type PageBuild,
  refreshPage,
} from "../src/tools/control-room/static";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

let page: PageBuild;
let builds: number;

beforeEach(() => {
  const root = freshTestDir(import.meta.file);
  builds = 0;
  page = {
    sources: resolve(root, "src"),
    lockfile: resolve(root, "bun.lock"),
    dist: resolve(root, "src", "ui", "dist"),
    lock: resolve(root, "dist.lock"),
    build: () => {
      builds++;
      writeAt(resolve(page.dist, "index.html"), Date.now() / 1000);
      return true;
    },
  };
  writeAt(resolve(page.sources, "server.ts"), secondsAgo(100));
  writeAt(page.lockfile, secondsAgo(100));
});

function secondsAgo(seconds: number): number {
  return Date.now() / 1000 - seconds;
}

function writeAt(file: string, seconds: number): void {
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, "x");
  utimesSync(file, seconds, seconds);
}

function builtAt(seconds: number): void {
  writeAt(resolve(page.dist, "index.html"), seconds);
}

function lockAgedBy(ms: number): void {
  mkdirSync(page.lock);
  const seconds = (Date.now() - ms) / 1000;
  utimesSync(page.lock, seconds, seconds);
}

function releaseLockAfter(ms: number): void {
  Bun.spawn([
    "bun",
    "-e",
    `setTimeout(() => { try { require("node:fs").rmdirSync(${JSON.stringify(page.lock)}) } catch {} }, ${ms})`,
  ]);
}

describe("whether the built page is up to date", () => {
  test("a page that was never built is not", () => {
    expect(isUpToDate(page)).toBe(false);
  });

  test("a page built after every source and the lockfile is", () => {
    builtAt(secondsAgo(10));
    expect(isUpToDate(page)).toBe(true);
  });

  test("a source edited after the build makes it stale", () => {
    builtAt(secondsAgo(10));
    writeAt(resolve(page.sources, "lib", "data.ts"), secondsAgo(5));
    expect(isUpToDate(page)).toBe(false);
  });

  test("a lockfile changed after the build makes it stale", () => {
    builtAt(secondsAgo(10));
    writeAt(page.lockfile, secondsAgo(5));
    expect(isUpToDate(page)).toBe(false);
  });

  test("the build's own output does not count as a source", () => {
    builtAt(secondsAgo(10));
    writeAt(resolve(page.dist, "assets", "index.js"), secondsAgo(5));
    expect(isUpToDate(page)).toBe(true);
  });

  test("a checkout with no lockfile judges by the sources alone", () => {
    page.lockfile = resolve(page.sources, "..", "absent.lock");
    builtAt(secondsAgo(10));
    expect(isUpToDate(page)).toBe(true);
  });
});

describe("building the page", () => {
  test("builds a stale page and releases the lock", () => {
    expect(buildPage(page)).toBe(true);
    expect(builds).toBe(1);
    expect(existsSync(page.lock)).toBe(false);
  });

  test("skips the build when another process brought it up to date first", () => {
    builtAt(secondsAgo(10));
    expect(buildPage(page)).toBe(true);
    expect(builds).toBe(0);
  });

  test("reports a failed build and still releases the lock", () => {
    page.build = () => false;
    expect(buildPage(page)).toBe(false);
    expect(existsSync(page.lock)).toBe(false);
  });

  test(
    "waits for a build another process holds the lock for",
    () => {
      lockAgedBy(0);
      releaseLockAfter(300);
      const started = Date.now();
      expect(buildPage(page)).toBe(true);
      expect(Date.now() - started).toBeGreaterThanOrEqual(250);
      expect(builds).toBe(1);
    },
    SPAWN_HEAVY_TEST_MS
  );

  test(
    "takes over a lock abandoned for longer than a build can take",
    () => {
      lockAgedBy(ABANDONED_LOCK_MS + 1000);
      releaseLockAfter(2000);
      const started = Date.now();
      expect(buildPage(page)).toBe(true);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(builds).toBe(1);
    },
    SPAWN_HEAVY_TEST_MS
  );

  test(
    "leaves a lock alone that is younger than that",
    () => {
      lockAgedBy(ABANDONED_LOCK_MS - 10_000);
      releaseLockAfter(300);
      const started = Date.now();
      buildPage(page);
      expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    },
    SPAWN_HEAVY_TEST_MS
  );
});

describe("refreshing the page on install", () => {
  test("a published install never builds", () => {
    expect(refreshPage(false, page)).toBeNull();
    expect(builds).toBe(0);
  });

  test("a checkout with a current page leaves it alone", () => {
    builtAt(secondsAgo(10));
    expect(refreshPage(true, page)).toBeNull();
    expect(builds).toBe(0);
  });

  test("a checkout with a stale page rebuilds it", () => {
    expect(refreshPage(true, page)).toBe(true);
    expect(builds).toBe(1);
  });
});

import { beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { freshTestDir } from "./test-home";

let home = "";
let server: ReturnType<typeof Bun.serve> | null = null;

/** A fresh PAL home per test, with the previous test's server stopped. */
export function controlRoomPerTest(testFile: string): void {
  beforeEach(() => {
    server?.stop(true);
    server = null;
    home = freshTestDir(testFile);
    process.env.PAL_HOME = home;
    mkdirSync(resolve(home, "memory", "ledger"), { recursive: true });
  });
}

export function controlRoomHome(): string {
  return home;
}

export function runningServer(): ReturnType<typeof Bun.serve> | null {
  return server;
}

export async function listen(): Promise<string> {
  const { startControlRoom } = await import("../../src/tools/control-room/server");
  server = startControlRoom(0);
  return `http://127.0.0.1:${server.port}`;
}

export async function getJson<T>(url: string): Promise<T> {
  return (await (await fetch(url)).json()) as T;
}

export async function post(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function registerProject(
  slug: string,
  body = "## Goal\n\nnone\n",
  updated = "2026-09-01T00:00:00.000Z"
): void {
  const dir = resolve(home, "memory", "projects", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "ISA.md"),
    `---\nname: ${slug}\nstatus: active\ncreated: 2026-09-01T00:00:00.000Z\nupdated: ${updated}\npath: ${home}\n---\n\n${body}`,
    "utf-8"
  );
}

/**
 * Bindings — where each project lives on THIS machine.
 *
 * A project record answers two questions in one field today: what the project
 * is (portable — name, goal, criteria, decisions) and where it sits on disk
 * (true on exactly one machine). The second answer rides inside `memory/`,
 * which is exported, so one machine's filesystem layout travels to every other
 * machine as though it were a fact about the project.
 *
 * This module holds the second answer separately. Memory becomes the union of
 * all work; bindings are one machine's intersection with its disk, so "that
 * project is not checked out here" turns into an ordinary state rather than a
 * dead path.
 *
 * `bindings.json` lives at the PAL_HOME root for the same reason `machine.json`
 * does: export walks `telos`, `memory`, `skills` and `agents`, so anything
 * under those would sync and defeat the point.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { palHome } from "./paths";

/** Project name → absolute path on this machine. */
export type Bindings = Record<string, string>;

export function bindingsFilePath(home: string = palHome()): string {
  return resolve(home, "bindings.json");
}

/**
 * Where the previous bindings are kept.
 *
 * Once a record stops storing its own path, this file is the only place a
 * project's location lives, and it is deliberately excluded from exports — so
 * losing it loses every location. One rolling copy of the last good content
 * makes that recoverable by renaming a file, and never goes stale the way a
 * one-off backup taken at migration time would.
 */
export function bindingsBackupPath(home: string = palHome()): string {
  return resolve(home, "bindings.backup.json");
}

function isBindingMap(value: unknown): value is Bindings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

/**
 * A malformed or unreadable file reads as empty rather than throwing. Bindings
 * are a lookup aid, so a corrupt one degrades to "nothing is bound here" — the
 * same state a fresh machine starts in — instead of breaking every caller.
 */
export function readBindings(home: string = palHome()): Bindings {
  const file = bindingsFilePath(home);
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
    if (!isBindingMap(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Seeding writes on the first project read, which makes an unsandboxed test a
 * silent writer into the developer's own ~/.pal. The suite sets PAL_TEST_SANDBOX,
 * so refuse there and name the file — a test that forgets to point PAL_HOME at a
 * temp dir fails loudly instead of editing the machine running it.
 */
function assertNotRealHomeDuringTests(home: string): void {
  if (!process.env.PAL_TEST_SANDBOX) return;
  if (resolve(home) !== resolve(homedir(), ".pal")) return;
  throw new Error(
    "Refusing to write bindings.json into the real ~/.pal during a test run. " +
      "Point PAL_HOME at a temp directory in this test's setup."
  );
}

export function writeBindings(bindings: Bindings, home: string = palHome()): void {
  assertNotRealHomeDuringTests(home);
  const file = bindingsFilePath(home);
  // Only a differing, non-empty predecessor is worth keeping: backing up an
  // identical file is noise, and backing up an empty one would let a bad write
  // erase the copy that made it recoverable.
  if (existsSync(file) && readFileSync(file, "utf-8").trim().length > 0) {
    copyFileSync(file, bindingsBackupPath(home));
  }
  const sorted: Bindings = {};
  for (const key of Object.keys(bindings).sort()) sorted[key] = bindings[key];
  writeFileSync(bindingsFilePath(home), `${JSON.stringify(sorted, null, 2)}\n`);
}

/** The absolute path this machine has for `project`, or null when unbound. */
export function bindingFor(project: string, home: string = palHome()): string | null {
  return readBindings(home)[project] ?? null;
}

/** Bind `project` to `path`, replacing any existing binding for it. */
export function writeBinding(
  project: string,
  path: string,
  home: string = palHome()
): void {
  const bindings = readBindings(home);
  bindings[project] = resolve(path);
  writeBindings(bindings, home);
}

export function removeBinding(project: string, home: string = palHome()): void {
  const bindings = readBindings(home);
  if (!(project in bindings)) return;
  delete bindings[project];
  writeBindings(bindings, home);
}

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
import { appendEvent } from "../bronze/events";
import { palHome, toPath } from "../core/paths";
import { type Bindings, bindingsFilePath, readBindings } from "../core/project-bindings";
import { adoptParkedHistory } from "./parked-history";

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

function nonEmptySoABadWriteCannotEraseTheBackup(file: string): boolean {
  return existsSync(file) && readFileSync(file, "utf-8").trim().length > 0;
}

export type BindingChange = {
  project: string;
  change: "bound" | "unbound";
  path: string;
};

export function bindingChanges(before: Bindings, after: Bindings): BindingChange[] {
  const bound = Object.entries(after)
    .filter(([project, path]) => before[project] !== path)
    .map(([project, path]): BindingChange => ({ project, change: "bound", path }));
  const unbound = Object.entries(before)
    .filter(([project]) => !(project in after))
    .map(([project, path]): BindingChange => ({ project, change: "unbound", path }));

  return [...bound, ...unbound];
}

/** The path is one machine's layout, so it travels as event text, never as a field. */
function logBindingChanges(changes: BindingChange[]): void {
  for (const { project, change, path } of changes)
    appendEvent("project", { change }, { project, content: { path } });
}

export function writeBindings(bindings: Bindings, home: string = palHome()): void {
  assertNotRealHomeDuringTests(home);
  const before = readBindings(home);
  const file = bindingsFilePath(home);
  if (nonEmptySoABadWriteCannotEraseTheBackup(file)) {
    copyFileSync(file, bindingsBackupPath(home));
  }

  const sorted: Bindings = {};

  for (const key of Object.keys(bindings).sort()) sorted[key] = bindings[key];
  writeFileSync(bindingsFilePath(home), `${JSON.stringify(sorted, null, 2)}\n`);
  logBindingChanges(bindingChanges(before, sorted));
  adoptParkedHistory(sorted, home);
}

/** Bind `project` to `path`, replacing any existing binding for it. */
export function writeBinding(
  project: string,
  path: string,
  home: string = palHome()
): void {
  const bindings = readBindings(home);
  bindings[project] = toPath(path);
  writeBindings(bindings, home);
}

/** Unbind `project` on this machine; returns the path it was bound to, or null when it was not. */
export function removeBinding(project: string, home: string = palHome()): string | null {
  const bindings = readBindings(home);
  const path = bindings[project];
  if (path === undefined) return null;
  delete bindings[project];
  writeBindings(bindings, home);

  return path;
}

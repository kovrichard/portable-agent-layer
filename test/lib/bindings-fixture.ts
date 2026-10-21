import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { freshTestDir } from "./test-home";

let home: string;

export function freshBindingsHome(file: string): string {
  home = freshTestDir(file);
  process.env.PAL_HOME = home;
  return home;
}

export async function seedLib() {
  return await import("../../src/hooks/lib/projects");
}

export async function addProject(name: string, path: string) {
  const { writeProject } = await seedLib();
  const now = new Date().toISOString();
  writeProject({ name, path, status: "active", created: now, updated: now });
}

/** A path that genuinely exists here — seeding refuses to adopt one that does not. */
export function checkout(name: string): string {
  const dir = resolve(home, "checkouts", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

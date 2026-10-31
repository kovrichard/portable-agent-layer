import { resolve } from "node:path";
import { readEvents } from "../../assets/plugins/dark-factory/scripts/lib.mjs";
import { freshTestDir } from "./test-home";

export const PLUGIN_ROOT = resolve(import.meta.dir, "../../assets/plugins/dark-factory");
export const NOW = new Date("2026-10-19T10:00:00Z");

export type FactoryEnv = Record<string, string | undefined>;

export function freshFactoryHome(file: string): { home: string; env: FactoryEnv } {
  const home = freshTestDir(file);
  return { home, env: { ...process.env, DARK_FACTORY_HOME: home } };
}

export function eventsNamedIn(env: FactoryEnv, name: string) {
  return readEvents(env).filter((event: { event: string }) => event.event === name);
}

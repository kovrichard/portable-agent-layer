/**
 * Where the morning's three moves live between sessions.
 *
 * A file, not a computation: the page reads it, the stop handler writes it, and
 * neither has to know how the other works.
 */

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { paths } from "./paths";

export interface AgendaMove {
  move: string;
  because: string;
}

export interface Agenda {
  generatedAt: string;
  moves: AgendaMove[];
}

/** @lintignore exercised directly by test/agenda-store.test.ts */
export function agendaPath(): string {
  return resolve(paths.state(), "agenda.json");
}

export function readAgenda(): Agenda | null {
  const path = agendaPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Agenda;
    return Array.isArray(parsed.moves) && parsed.generatedAt ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeAgenda(agenda: Agenda): Promise<void> {
  await writeFile(agendaPath(), `${JSON.stringify(agenda, null, 2)}\n`, "utf-8");
}

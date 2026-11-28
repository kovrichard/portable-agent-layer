/// <reference path="./madge.d.ts" />
import madge from "madge";

export type ImportGraph = Record<string, string[]>;

const PRELOADS = ["test/setup.ts"];

function importersOf(graph: ImportGraph): Map<string, string[]> {
  const importers = new Map<string, string[]>();

  for (const [file, imports] of Object.entries(graph))
    for (const imported of imports)
      importers.set(imported, [...(importers.get(imported) ?? []), file]);

  return importers;
}

function everyFileThatReaches(targets: string[], graph: ImportGraph): Set<string> {
  const importers = importersOf(graph);
  const reached = new Set(targets);
  const pending = [...targets];

  while (pending.length > 0) {
    const file = pending.pop() as string;

    for (const importer of importers.get(file) ?? []) {
      if (reached.has(importer)) continue;
      reached.add(importer);
      pending.push(importer);
    }
  }

  return reached;
}

/**
 * The test files that can observe a mutant in `mutated`: those that import it,
 * directly or through other modules. A preload reaches every test, so a mutated
 * file it imports keeps the whole list.
 */
export function testsObserving(
  mutated: string[],
  tests: string[],
  graph: ImportGraph
): string[] {
  const reaching = everyFileThatReaches(mutated, graph);
  if (PRELOADS.some((preload) => reaching.has(preload))) return tests;

  return tests.filter((test) => reaching.has(test));
}

export async function importGraph(): Promise<ImportGraph> {
  const result = await madge(["test", "src"], {
    fileExtensions: ["ts"],
    tsConfig: "tsconfig.json",
  });

  return result.obj();
}

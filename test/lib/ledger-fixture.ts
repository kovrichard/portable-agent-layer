import { freshTestDir } from "./test-home";

export const APPLIED = {
  tool: "Edit",
  target: "/work/app/src/index.ts",
  outcome: "applied" as const,
  before: "const a = 1;",
  after: "const a = 2;",
};

export async function freshLedgerHome(file: string): Promise<string> {
  const home = freshTestDir(file);
  process.env.PAL_HOME = home;
  delete process.env.PAL_SPAWNED_INFERENCE;
  delete process.env.PAL_AGENT;
  (await import("../../src/hooks/lib/settings")).reload();
  return home;
}

export async function ledgerLib() {
  return await import("../../src/hooks/lib/ledger");
}

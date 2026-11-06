import { describe, expect, test } from "bun:test";
import {
  findMissingRefs,
  formatReport,
  sourcesOf,
} from "../.agents/scripts/check-closing-refs";

const REPO = "kovrichard/portable-agent-layer";
const EXISTING = new Set([183]);

async function existsInRepo(issue: number): Promise<boolean> {
  return EXISTING.has(issue);
}

function prWith(body: string, commitMessages: string[] = []) {
  return sourcesOf({
    body,
    commits: commitMessages.map((message, index) => ({
      oid: `${index}abcdef0123456789`,
      messageHeadline: message,
      messageBody: "",
    })),
  });
}

describe("findMissingRefs", () => {
  test("a bare closing keyword on a missing issue fails", async () => {
    const missing = await findMissingRefs(
      prWith("a stable release fixes #4791"),
      REPO,
      existsInRepo
    );
    expect(missing.map((ref) => ref.issue)).toEqual([4791]);
    expect(missing[0].where).toBe("the PR body");
  });

  test("a closing keyword naming another repo passes", async () => {
    const missing = await findMissingRefs(
      prWith("fixes rtk-ai/rtk#4791"),
      REPO,
      existsInRepo
    );
    expect(missing).toEqual([]);
  });

  test("a reference without a closing keyword passes", async () => {
    const missing = await findMissingRefs(prWith("see #4791"), REPO, existsInRepo);
    expect(missing).toEqual([]);
  });

  test("a closing keyword on an existing issue passes", async () => {
    const missing = await findMissingRefs(prWith("closes #183"), REPO, existsInRepo);
    expect(missing).toEqual([]);
  });

  test("a closing keyword in a commit message is caught", async () => {
    const missing = await findMissingRefs(
      prWith("clean body", ["fix: something", "fix: other\n\nfixes #999999"]),
      REPO,
      existsInRepo
    );
    expect(missing.map((ref) => [ref.issue, ref.where])).toEqual([
      [999999, "commit 1abcdef"],
    ]);
  });
});

describe("formatReport", () => {
  test("names the number, where it was found, and the fix", () => {
    const report = formatReport(
      [{ where: "commit 1abcdef", raw: "fixes #999999", issue: 999999 }],
      REPO
    );
    expect(report).toContain('"fixes #999999" in commit 1abcdef');
    expect(report).toContain("write owner/repo#N, or drop the closing keyword");
  });
});

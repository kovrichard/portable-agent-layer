import issueParser from "issue-parser";

export interface Source {
  where: string;
  text: string;
}

export interface ClosingRef {
  where: string;
  raw: string;
  issue: number;
}

type IssueExists = (issue: number) => Promise<boolean>;

const parseGithub = issueParser("github");

function targetsThisRepo(slug: string | undefined, repo: string): boolean {
  return slug === undefined || slug === repo;
}

function closingRefsIn(source: Source, repo: string): ClosingRef[] {
  return parseGithub(source.text)
    .actions.close.filter((action) => targetsThisRepo(action.slug, repo))
    .map((action) => ({
      where: source.where,
      raw: action.raw,
      issue: Number.parseInt(action.issue, 10),
    }));
}

export async function findMissingRefs(
  sources: Source[],
  repo: string,
  exists: IssueExists
): Promise<ClosingRef[]> {
  const refs = sources.flatMap((source) => closingRefsIn(source, repo));
  const issues = [...new Set(refs.map((ref) => ref.issue))];
  const found = await Promise.all(issues.map(exists));
  const missing = new Set(issues.filter((_, index) => !found[index]));
  return refs.filter((ref) => missing.has(ref.issue));
}

export function formatReport(missing: ClosingRef[], repo: string): string {
  const lines = missing.map(
    (ref) =>
      `- "${ref.raw}" in ${ref.where}: #${ref.issue} is not an issue or pull request in ${repo}`
  );
  return [
    "Closing keywords point at issues that do not exist in this repo.",
    "semantic-release looks every one of them up after publishing and fails the release.",
    ...lines,
    "Fix: write owner/repo#N, or drop the closing keyword.",
  ].join("\n");
}

interface PullRequestJson {
  body: string;
  commits: { oid: string; messageHeadline: string; messageBody: string }[];
}

export function sourcesOf(pr: PullRequestJson): Source[] {
  return [
    { where: "the PR body", text: pr.body },
    ...pr.commits.map((commit) => ({
      where: `commit ${commit.oid.slice(0, 7)}`,
      text: `${commit.messageHeadline}\n\n${commit.messageBody}`,
    })),
  ];
}

function gh(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["gh", ...args]);
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function readPullRequest(pr: string, repo: string): PullRequestJson {
  const result = gh(["pr", "view", pr, "--repo", repo, "--json", "body,commits"]);
  if (!result.ok) throw new Error(`gh pr view ${pr} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function issueExistsOnGithub(repo: string): IssueExists {
  return async (issue) => {
    const result = gh(["api", `repos/${repo}/issues/${issue}`, "--silent"]);
    if (result.ok) return true;
    if (result.stderr.includes("HTTP 404")) return false;
    throw new Error(`gh api repos/${repo}/issues/${issue} failed: ${result.stderr}`);
  };
}

function currentRepo(): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const result = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  if (!result.ok) throw new Error(`gh repo view failed: ${result.stderr}`);
  return result.stdout.trim();
}

if (import.meta.main) {
  const pr = process.argv[2];
  if (!pr) {
    process.stderr.write(
      "Usage: bun .agents/scripts/check-closing-refs.ts <pr-number>\n"
    );
    process.exit(2);
  }
  const repo = currentRepo();
  const sources = sourcesOf(readPullRequest(pr, repo));
  const missing = await findMissingRefs(sources, repo, issueExistsOnGithub(repo));
  if (missing.length > 0) {
    process.stderr.write(`${formatReport(missing, repo)}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `Every closing keyword in PR #${pr} points at an existing issue.\n`
  );
}

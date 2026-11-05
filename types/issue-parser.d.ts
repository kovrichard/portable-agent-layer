declare module "issue-parser" {
  interface Action {
    raw: string;
    action: string;
    slug?: string;
    prefix: string;
    issue: string;
  }

  interface ParseResult {
    actions: { close: Action[] };
  }

  export default function issueParser(preset: "github"): (text: string) => ParseResult;
}

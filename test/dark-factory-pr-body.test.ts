import { describe, expect, test } from "bun:test";
import { prBody } from "../assets/plugins/dark-factory/scripts/ship.mjs";

const SPEC = `# Split a big file

Request: ISC-1. Repo: r, base branch \`canary\`.

## Goal

Make the file small.

## Context

${"Long background the reviewer does not need. ".repeat(200)}

## Acceptance criteria

1. The file is gone.

## Decisions

The user was not available.

1. **No barrel.** Every importer is in this repo.
2. **Scope \`src/**\`, severity \`warn\`.** The request says so.
3. **The layout is fixed in this spec**, so it is checkable.
- The project comes from the cwd, not the folder name. Reason: the name is lossy.
- Two rules, not one (PO; user approved): klint scopes each.

## Weakest assumption

That one test file is enough.

Second: the layout came from a scan.
`;

describe("prBody", () => {
  const body = prBody(SPEC);

  test("keeps the request, the goal and the weakest assumption's first paragraph", () => {
    expect(body).toContain("Request: ISC-1.");
    expect(body).toContain("## Goal\n\nMake the file small.");
    expect(body).toContain("## Weakest assumption\n\nThat one test file is enough.");
    expect(body).not.toContain("Second: the layout");
  });

  test("leaves out the context and the acceptance criteria", () => {
    expect(body).not.toContain("Long background");
    expect(body).not.toContain("The file is gone.");
    expect(body.split(/\s+/).length).toBeLessThan(150);
  });

  test("lists each decision by its headline only", () => {
    expect(body).toContain("1. No barrel.\n");
    expect(body).toContain("2. Scope `src/**`, severity `warn`.\n");
    expect(body).toContain("3. The layout is fixed in this spec\n");
    expect(body).toContain("- The project comes from the cwd, not the folder name\n");
    expect(body).toContain("- Two rules, not one (PO; user approved)\n");
    expect(body).not.toContain("Every importer");
  });

  test("a spec without the expected sections is passed through whole", () => {
    expect(prBody("# T\n\nJust text.")).toContain("Just text.");
  });

  test("ends with the factory footer", () => {
    expect(body.trimEnd().endsWith("Opened by dark-factory.")).toBe(true);
  });
});

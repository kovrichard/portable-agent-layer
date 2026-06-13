import { describe, expect, test } from "bun:test";
import { applyAttribution, buildAttributionText, PAL_REPO_URL } from "../src/targets/lib";

describe("buildAttributionText", () => {
  test("composes commit footer (bare URL) and PR line (markdown link)", () => {
    expect(buildAttributionText("Jarvis")).toEqual({
      commit: `Co-authored by Jarvis · ${PAL_REPO_URL}`,
      pr: `Co-authored by [Jarvis](${PAL_REPO_URL})`,
    });
  });

  test("interpolates the identity name — nothing hardcoded", () => {
    const { commit, pr } = buildAttributionText("Friday");
    expect(commit).toContain("Friday");
    expect(pr).toContain("[Friday]");
    expect(commit).not.toContain("Jarvis");
  });

  test("PR link points at the public repo, not pal.konvert7.com", () => {
    expect(buildAttributionText("Atlas").pr).toContain(
      "github.com/kovrichard/portable-agent-layer"
    );
    expect(buildAttributionText("Atlas").pr).not.toContain("pal.konvert7.com");
  });
});

describe("applyAttribution", () => {
  test("enabled → fills attribution and drops Claude's byline", () => {
    const result = applyAttribution({}, { enabled: true, name: "Jarvis" });
    expect(result.attribution).toEqual({
      commit: `Co-authored by Jarvis · ${PAL_REPO_URL}`,
      pr: `Co-authored by [Jarvis](${PAL_REPO_URL})`,
    });
    expect(result.includeCoAuthoredBy).toBe(false);
  });

  test("disabled → clears attribution and restores default byline", () => {
    const enabled = applyAttribution({}, { enabled: true, name: "Jarvis" });
    const disabled = applyAttribution(enabled, { enabled: false, name: "Jarvis" });
    expect(disabled.attribution).toEqual({ commit: "", pr: "" });
    expect("includeCoAuthoredBy" in disabled).toBe(false);
  });

  test("does not mutate the input settings object", () => {
    const input = { attribution: { commit: "", pr: "" } };
    applyAttribution(input, { enabled: true, name: "Jarvis" });
    expect(input.attribution).toEqual({ commit: "", pr: "" });
  });

  test("preserves unrelated settings keys", () => {
    const result = applyAttribution(
      { respectGitignore: true, hooks: { Stop: [] } },
      { enabled: true, name: "Jarvis" }
    );
    expect(result.respectGitignore).toBe(true);
    expect(result.hooks).toEqual({ Stop: [] });
  });
});

import { describe, expect, test } from "bun:test";
import {
  repoPermissionsFrom,
  withRepoPermissions,
} from "../assets/plugins/dark-factory/scripts/settings.mjs";

describe("repoPermissionsFrom", () => {
  test("empty repo settings give null", () => {
    expect(repoPermissionsFrom({})).toBeNull();
  });

  test("settings without permissions give null", () => {
    expect(repoPermissionsFrom({ hooks: { Stop: [] } })).toBeNull();
  });

  test("allow, deny and ask lists are all copied", () => {
    expect(
      repoPermissionsFrom({ permissions: { allow: ["a"], deny: ["d"], ask: ["k"] } })
    ).toEqual({ allow: ["a"], deny: ["d"], ask: ["k"] });
  });

  test("only the permission lists are copied, not defaultMode or additionalDirectories", () => {
    expect(
      repoPermissionsFrom({
        permissions: { deny: ["d"], defaultMode: "plan", additionalDirectories: ["/x"] },
      })
    ).toEqual({ deny: ["d"] });
  });

  test("a permission list that is not an array is ignored, giving null", () => {
    expect(repoPermissionsFrom({ permissions: { allow: "a" } })).toBeNull();
  });

  test("permissions that is an array rather than an object gives null", () => {
    expect(repoPermissionsFrom({ permissions: ["a"] })).toBeNull();
  });

  test("empty permissions object gives null", () => {
    expect(repoPermissionsFrom({ permissions: {} })).toBeNull();
  });

  test("empty allow and ask lists are still copied", () => {
    expect(repoPermissionsFrom({ permissions: { ask: [], allow: [] } })).toEqual({
      allow: [],
      ask: [],
    });
  });
});

describe("withRepoPermissions", () => {
  test("null kept and null permissions give null", () => {
    expect(withRepoPermissions(null, null)).toBeNull();
  });

  test("kept settings pass through when the repo has no permissions", () => {
    const kept = { attribution: { commit: "A" } };
    expect(withRepoPermissions(kept, null)).toEqual({ attribution: { commit: "A" } });
  });

  test("repo permissions alone become the whole file", () => {
    expect(withRepoPermissions(null, { deny: ["d"] })).toEqual({
      permissions: { deny: ["d"] },
    });
  });

  test("kept settings and repo permissions are both written", () => {
    const kept = { attribution: { commit: "A" } };
    expect(withRepoPermissions(kept, { allow: ["a"], deny: ["d"], ask: ["k"] })).toEqual({
      attribution: { commit: "A" },
      permissions: { allow: ["a"], deny: ["d"], ask: ["k"] },
    });
  });
});

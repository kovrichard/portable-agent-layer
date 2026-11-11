import { describe, expect, test } from "bun:test";
import { isDirectChild } from "../src/hooks/lib/paths";

describe("isDirectChild", () => {
  test("a file directly inside the parent is a direct child", () => {
    expect(isDirectChild("/pkg/assets/agents", "/pkg/assets/agents/scout.md")).toBe(true);
  });

  test("a trailing separator on the parent still gives a direct child", () => {
    expect(isDirectChild("/pkg/assets/agents/", "/pkg/assets/agents/scout.md")).toBe(
      true
    );
  });

  test("a file in a subfolder of the parent is not a direct child", () => {
    expect(isDirectChild("/pkg/assets/agents", "/pkg/assets/agents/sub/scout.md")).toBe(
      false
    );
  });

  test("a sibling folder sharing the parent's prefix is not a direct child", () => {
    expect(isDirectChild("/pkg/assets/agents", "/pkg/assets/agents-old/scout.md")).toBe(
      false
    );
  });

  test("a folder elsewhere that is also named agents is not a direct child", () => {
    expect(isDirectChild("/pkg/assets/agents", "/elsewhere/agents/scout.md")).toBe(false);
  });

  test("the parent folder itself is not a direct child", () => {
    expect(isDirectChild("/pkg/assets/agents", "/pkg/assets/agents")).toBe(false);
  });

  test("the parent's parent is not a direct child", () => {
    expect(isDirectChild("/pkg/assets/agents", "/pkg/assets/scout.md")).toBe(false);
  });
});

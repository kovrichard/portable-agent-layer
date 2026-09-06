import { describe, expect, test } from "bun:test";
import { categorizeLearning } from "../src/hooks/lib/learning-category";

// Which bucket a captured learning lands in, and so which digest it later shows
// up in. It was only ever called from a spawned handler, so the keyword list had
// never been checked against anything.

// Duplicated deliberately: asserting the list against itself would pass however
// the list changed. Each word is a claim that this word means "system".
const SYSTEM_WORDS = [
  "config",
  "setting",
  "install",
  "deploy",
  "build",
  "lint",
  "format",
  "biome",
  "typescript",
  "tsc",
  "hook",
  "plugin",
  "ci",
  "cd",
  "pipeline",
  "docker",
  "package",
  "dependency",
  "migration",
  "schema",
  "database",
  "env",
  "permission",
  "security",
  "git",
  "commit",
  "branch",
  "merge",
];

describe("categorizeLearning", () => {
  test.each(SYSTEM_WORDS)("%s means the learning was about the system", (word) => {
    expect(categorizeLearning(`Fixed the ${word} problem`)).toBe("system");
  });

  test("a learning about approach is an algorithm one", () => {
    expect(categorizeLearning("Ask before assuming which reading was meant")).toBe(
      "algorithm"
    );
  });

  // The default matters: an unrecognised learning is about how the work was
  // done, not about the tooling, and misfiling it hides it from the reflection
  // digest that reads the algorithm bucket.
  test("anything unrecognised falls to algorithm rather than system", () => {
    expect(categorizeLearning("")).toBe("algorithm");
    expect(categorizeLearning("Rewrote the summary in the user's own words")).toBe(
      "algorithm"
    );
  });

  test("matches whatever the case", () => {
    expect(categorizeLearning("TypeScript strictness")).toBe("system");
    expect(categorizeLearning("GIT rebase")).toBe("system");
  });

  test("reads every argument, not only the title", () => {
    expect(categorizeLearning("A vague title", "the summary mentions docker")).toBe(
      "system"
    );
  });

  // They are separate texts, so they are separated before matching: run them
  // together and a keyword ending one fuses with the word starting the next,
  // which the boundary then rejects.
  test("keeps the arguments apart, so a keyword at a boundary still matches", () => {
    expect(categorizeLearning("Reworked the build", "steps were slow")).toBe("system");
  });

  test("one system word anywhere is enough", () => {
    expect(
      categorizeLearning("Chose a clearer name", "which also needed a schema change")
    ).toBe("system");
  });

  // Whole words only, so "commitment" and "branching out" are not tooling.
  test("a keyword inside a longer word does not count", () => {
    expect(categorizeLearning("Showed more commitment to the plan")).toBe("algorithm");
    expect(categorizeLearning("Branching out into a new approach")).toBe("algorithm");
    expect(categorizeLearning("Encoded the settings")).toBe("algorithm");
  });

  // The same rule read the other way: "configuration" is not "config", so a
  // learning that spells the word out lands in algorithm.
  test("and that cuts against it too — the longer spelling is not matched", () => {
    expect(categorizeLearning("Reworked the configuration loader")).toBe("algorithm");
    expect(categorizeLearning("Reworked the config loader")).toBe("system");
  });

  test("a keyword next to punctuation still counts", () => {
    expect(categorizeLearning("Broke the build.")).toBe("system");
    expect(categorizeLearning("(hook) ordering")).toBe("system");
  });
});

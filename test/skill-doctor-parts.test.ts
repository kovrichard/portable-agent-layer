import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  collectSkillFiles,
  findAbsolutePaths,
  leadTriggers,
  lintSkill,
  metadataField,
  parseSkill,
  quoteList,
  stripCode,
  topLevelField,
} from "../src/tools/lib/skill-doctor";

const ROOT = resolve(import.meta.dir, "../.test-home-skill-doctor-parts");

let counter = 0;
/** A skill directory holding exactly the files given, keyed by relative path. */
function skillDir(files: Record<string, string>): string {
  counter += 1;
  const dir = resolve(ROOT, `case-${counter}`);
  for (const [rel, content] of Object.entries(files)) {
    const target = resolve(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
});

describe("parseSkill", () => {
  const withFrontmatter = (fm: string, body = "\n# Body\n") => `---\n${fm}\n---${body}`;

  // No delimiters means no frontmatter — every field is absent and the whole
  // text is body, so the caller reports missing name/description rather than
  // mis-reading prose as YAML.
  test("a file with no frontmatter yields empty fields and the whole text as body", () => {
    const parsed = parseSkill("# Just a heading\n");
    expect(parsed).toEqual({
      name: null,
      description: null,
      descriptionQuoted: false,
      triggers: [],
      shipped: false,
      license: null,
      derivedFrom: null,
      body: "# Just a heading\n",
    });
  });

  test("a lone delimiter is not frontmatter", () => {
    expect(parseSkill("---\nname: x\n").name).toBeNull();
  });

  test("reads the name and the description", () => {
    const parsed = parseSkill(
      withFrontmatter('name: my-skill\ndescription: "Does a thing."')
    );
    expect(parsed.name).toBe("my-skill");
    expect(parsed.description).toBe("Does a thing.");
  });

  test("strips the surrounding quotes and records that they were there", () => {
    expect(parseSkill(withFrontmatter('description: "quoted"')).descriptionQuoted).toBe(
      true
    );
    expect(parseSkill(withFrontmatter("description: unquoted")).descriptionQuoted).toBe(
      false
    );
    expect(parseSkill(withFrontmatter("description: unquoted")).description).toBe(
      "unquoted"
    );
  });

  // One quote is not a pair; stripping it would corrupt the value.
  test("a half-quoted description is not treated as quoted", () => {
    for (const raw of ['"open', 'close"', '"']) {
      const parsed = parseSkill(withFrontmatter(`description: ${raw}`));
      expect(parsed.descriptionQuoted).toBe(false);
      expect(parsed.description).toBe(raw);
    }
  });

  test("an empty description reads as absent rather than as an empty string", () => {
    expect(parseSkill(withFrontmatter("description:")).description).toBe("");
  });

  // A body may contain its own --- rules; only the first two delimiters end the
  // frontmatter. The rule itself is rejoined without the newline the delimiter
  // pattern consumed, which the body checks (line count, voice, links) survive.
  test("keeps horizontal rules that appear in the body", () => {
    const parsed = parseSkill("---\nname: x\n---\nintro\n\n---\n\noutro\n");
    expect(parsed.body).toBe("\nintro\n\n---\noutro\n");
    expect(parsed.name).toBe("x");
  });

  test("recognises a skill shipped by this repo", () => {
    const shipped = withFrontmatter("name: x\nmetadata:\n  source: portable-agent-layer");
    expect(parseSkill(shipped).shipped).toBe(true);
    expect(parseSkill(withFrontmatter("name: x")).shipped).toBe(false);
  });

  test("a different source is not this repo's", () => {
    expect(
      parseSkill(withFrontmatter("name: x\nmetadata:\n  source: somewhere-else")).shipped
    ).toBe(false);
  });

  test("reads the licence and the origin it was derived from", () => {
    const parsed = parseSkill(
      withFrontmatter("name: x\nlicense: MIT\nmetadata:\n  derived-from: https://ex.com")
    );
    expect(parsed.license).toBe("MIT");
    expect(parsed.derivedFrom).toBe("https://ex.com");
  });

  test("reads the declared triggers", () => {
    const parsed = parseSkill(
      withFrontmatter('name: x\nmetadata:\n  triggers:\n    - "a b"\n    - "c d"')
    );
    expect(parsed.triggers).toEqual(["a b", "c d"]);
  });
});

describe("topLevelField", () => {
  test("reads an unindented key and unquotes the value", () => {
    expect(topLevelField('license: "MIT"', "license")).toBe("MIT");
    expect(topLevelField("license: MIT", "license")).toBe("MIT");
  });

  test("an absent key reads as null", () => {
    expect(topLevelField("name: x", "license")).toBeNull();
  });
});

describe("metadataField", () => {
  test("reads an indented key under metadata", () => {
    expect(metadataField("metadata:\n  source: pal", "source")).toBe("pal");
    expect(metadataField("metadata:\n\tsource: pal", "source")).toBe("pal");
  });

  // The indent is what distinguishes a nested key from a top-level one.
  test("an unindented key of the same name is not a metadata field", () => {
    expect(metadataField("source: top-level", "source")).toBeNull();
  });
});

describe("quoteList", () => {
  test("quotes each entry and joins them with the separator", () => {
    expect(quoteList(["a", "b"], ", ")).toBe('"a", "b"');
    expect(quoteList(["a", "b"], " then ")).toBe('"a" then "b"');
  });

  test("an empty list renders as an empty string", () => {
    expect(quoteList([], ", ")).toBe("");
  });
});

describe("leadTriggers", () => {
  // A hyphenated name has two forms a prompt might use; a single word has one.
  test("a hyphenated name requires both the name and its spaced form", () => {
    expect(leadTriggers("my-skill")).toEqual(["my-skill", "my skill"]);
    expect(leadTriggers("a-b-c")).toEqual(["a-b-c", "a b c"]);
  });

  test("a single-word name requires only itself", () => {
    expect(leadTriggers("skill")).toEqual(["skill"]);
  });
});

describe("stripCode", () => {
  test("removes fenced blocks", () => {
    expect(stripCode("before\n```\nrm -rf /\n```\nafter")).toBe("before\n\nafter");
  });

  test("removes inline spans", () => {
    expect(stripCode("use `I will` here")).toBe("use  here");
  });

  test("leaves prose untouched", () => {
    expect(stripCode("plain prose")).toBe("plain prose");
  });

  // Two separate fences must not have the text between them swallowed.
  test("strips each fence separately rather than everything between them", () => {
    expect(stripCode("```\na\n```\nkeep\n```\nb\n```")).toBe("\nkeep\n");
  });

  // A fence is removed whole. Leaving it to the inline-span pass instead would
  // pair its backticks with the ones inside it and leave fragments behind.
  test("removes a fenced block that itself contains an inline span", () => {
    expect(stripCode("```md\nuse `x` here\n```")).toBe("");
  });
});

describe("collectSkillFiles", () => {
  function names(dir: string): string[] {
    return collectSkillFiles(dir)
      .map((f) => relative(dir, f).replaceAll("\\", "/"))
      .sort();
  }

  test("collects scannable files, recursing into subdirectories", () => {
    const dir = skillDir({
      "SKILL.md": "x",
      "tools/run.ts": "x",
      "tools/nested/go.py": "x",
    });
    expect(names(dir)).toEqual(["SKILL.md", "tools/nested/go.py", "tools/run.ts"]);
  });

  test("ignores files of other extensions", () => {
    const dir = skillDir({ "SKILL.md": "x", "logo.png": "x", "data.csv": "x" });
    expect(names(dir)).toEqual(["SKILL.md"]);
  });

  // Vendored and VCS trees are not the skill's own text.
  test("skips node_modules and dot-directories", () => {
    const dir = skillDir({
      "SKILL.md": "x",
      "node_modules/dep/index.ts": "x",
      ".git/config.ts": "x",
      ".hidden.ts": "x",
    });
    expect(names(dir)).toEqual(["SKILL.md"]);
  });
});

describe("findAbsolutePaths", () => {
  // The hit names the machine-specific prefix, not the whole path — the prefix
  // is the part that will not survive an export.
  test("reports a POSIX home path with its file and line", () => {
    const dir = skillDir({ "SKILL.md": "intro\nrun /home/someone/bin/go\n" });
    expect(findAbsolutePaths(dir)).toEqual(["SKILL.md:2 → /home/someone"]);
  });

  test("finds macOS, root and Windows profile paths too", () => {
    const dir = skillDir({
      "SKILL.md": "/Users/someone/x\n",
      "a.ts": "/root/r\n",
      "b.sh": "C:\\Users\\someone\\x\n",
    });
    expect(findAbsolutePaths(dir).sort()).toEqual([
      "SKILL.md:1 → /Users/someone",
      "a.ts:1 → /root/r",
      "b.sh:1 → C:\\Users\\someone",
    ]);
  });

  // Portable forms are the fix this check asks for; flagging them would be noise.
  test("does not flag portable path forms", () => {
    const dir = skillDir({
      "SKILL.md": "$HOME/bin\n~/bin\n%USERPROFILE%/bin\n$PAL_HOME/x\n",
    });
    expect(findAbsolutePaths(dir)).toEqual([]);
  });

  test("reports every occurrence across every scanned file", () => {
    const dir = skillDir({
      "SKILL.md": "/home/a/x\n/home/b/y\n",
      "tools/t.ts": "/home/c/z\n",
    });
    expect(findAbsolutePaths(dir).length).toBe(3);
  });
});

describe("lintSkill structural failures", () => {
  test("a directory that does not exist is one structural error", () => {
    const report = lintSkill(resolve(ROOT, "no-such-dir"));
    expect(report.errors).toBe(1);
    expect(report.name).toBeNull();
    expect(report.findings).toEqual([
      {
        level: "error",
        check: "structure",
        message: `No skill directory at ${resolve(ROOT, "no-such-dir")}`,
      },
    ]);
  });

  test("a directory with no SKILL.md is one structural error", () => {
    const dir = skillDir({ "README.md": "not a skill" });
    const report = lintSkill(dir);
    expect(report.errors).toBe(1);
    expect(report.findings[0].message).toBe(`No SKILL.md found in ${dir}`);
  });

  // Neither failure gets far enough to have read a name.
  test("a structural failure stops before any other check runs", () => {
    expect(lintSkill(skillDir({ "README.md": "x" })).findings.length).toBe(1);
  });
});

const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_BODY_LINES = 500;

/** A skill whose folder matches its frontmatter name, so name.folder passes. */
function lintOf(fm: string, body = "\n# Body\n", folder = "s") {
  counter += 1;
  const dir = resolve(ROOT, `lint-${counter}`, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "SKILL.md"), `---\n${fm}\n---${body}`);
  return lintSkill(dir);
}

function levelOf(report: ReturnType<typeof lintSkill>, check: string) {
  return report.findings.find((f) => f.check === check)?.level;
}

describe("lintSkill limits are inclusive at the boundary", () => {
  test("a name of exactly the maximum length passes", () => {
    const name = "a".repeat(MAX_NAME);
    expect(levelOf(lintOf(`name: ${name}`, "\n# B\n", name), "name.length")).toBe("pass");
  });

  test("one character over the maximum is an error", () => {
    const name = "a".repeat(MAX_NAME + 1);
    expect(levelOf(lintOf(`name: ${name}`, "\n# B\n", name), "name.length")).toBe(
      "error"
    );
  });

  test("a description of exactly the maximum length passes", () => {
    const d = "a".repeat(MAX_DESCRIPTION);
    expect(levelOf(lintOf(`name: s\ndescription: "${d}"`), "description.length")).toBe(
      "pass"
    );
  });

  test("one character over the description maximum is an error", () => {
    const d = "a".repeat(MAX_DESCRIPTION + 1);
    expect(levelOf(lintOf(`name: s\ndescription: "${d}"`), "description.length")).toBe(
      "error"
    );
  });

  // The newline that separates the closing --- from the body is itself the
  // first of the body's lines.
  const bodyOfLines = (n: number) =>
    `\n${Array.from({ length: n - 1 }, () => "line").join("\n")}`;

  test("the body fixture really has the line count it claims", () => {
    const parsed = parseSkill(`---\nname: s\n---${bodyOfLines(3)}`);
    expect(parsed.body.split("\n").length).toBe(3);
  });

  test("a body of exactly the maximum line count passes", () => {
    expect(levelOf(lintOf("name: s", bodyOfLines(MAX_BODY_LINES)), "body.length")).toBe(
      "pass"
    );
  });

  test("one line over the body maximum warns", () => {
    expect(
      levelOf(lintOf("name: s", bodyOfLines(MAX_BODY_LINES + 1)), "body.length")
    ).toBe("warn");
  });
});

describe("lintSkill missing frontmatter fields", () => {
  test("a missing name is an error and skips the folder comparison", () => {
    const report = lintOf('description: "Does a thing. Use when asked."');
    expect(levelOf(report, "name")).toBe("error");
    expect(levelOf(report, "name.folder")).toBeUndefined();
    expect(levelOf(report, "name.length")).toBeUndefined();
  });

  test("a missing description is an error and skips the description checks", () => {
    const report = lintOf("name: s");
    expect(levelOf(report, "description")).toBe("error");
    expect(levelOf(report, "description.length")).toBeUndefined();
    expect(levelOf(report, "description.quoted")).toBeUndefined();
  });

  // The lead-trigger check needs both a name to derive the lead from and
  // triggers to compare against.
  test("the lead-trigger check needs a name and at least one trigger", () => {
    expect(levelOf(lintOf("name: s"), "metadata.triggers.lead")).toBeUndefined();
    expect(
      levelOf(lintOf('metadata:\n  triggers:\n    - "a"'), "metadata.triggers.lead")
    ).toBeUndefined();
    expect(
      levelOf(
        lintOf('name: s\nmetadata:\n  triggers:\n    - "s"'),
        "metadata.triggers.lead"
      )
    ).toBe("pass");
  });

  // Declaring none and declaring too few are different problems with different
  // advice, not one warning with a count in it.
  test("no triggers at all warns differently from too few", () => {
    const messageOf = (r: ReturnType<typeof lintSkill>) =>
      r.findings.find((f) => f.check === "metadata.triggers")?.message ?? "";
    const none = lintOf("name: s");
    expect(levelOf(none, "metadata.triggers")).toBe("warn");
    expect(messageOf(none)).toContain("no metadata.triggers declared");
    expect(messageOf(none)).not.toContain("only 0");

    const few = lintOf('name: s\nmetadata:\n  triggers:\n    - "s"');
    expect(messageOf(few)).toContain("only 1 trigger(s)");
  });
});

describe("frontmatter keys are read at the line start only", () => {
  test("an indented name under metadata is not the skill's name", () => {
    expect(parseSkill("---\nmetadata:\n  name: nested\n---\nbody\n").name).toBeNull();
  });

  test("an indented description under metadata is not the description", () => {
    expect(
      parseSkill("---\nmetadata:\n  description: nested\n---\nbody\n").description
    ).toBeNull();
  });

  // Only a line that is exactly --- closes the frontmatter.
  test("a body line merely ending in --- does not split the document", () => {
    expect(parseSkill("---\nname: x\n---\nfoo---\n").body).toBe("\nfoo---\n");
  });

  test("the space after the key is optional", () => {
    expect(parseSkill("---\nname:tight\n---\nbody\n").name).toBe("tight");
  });
});

describe("name charset is checked end to end", () => {
  test("a trailing invalid character is still an error", () => {
    expect(levelOf(lintOf("name: abc!", "\n# B\n", "abc!"), "name.charset")).toBe(
      "error"
    );
  });

  test("an all-valid name passes", () => {
    expect(levelOf(lintOf("name: a-b-9", "\n# B\n", "a-b-9"), "name.charset")).toBe(
      "pass"
    );
  });
});

describe("lintSkill tallies", () => {
  test("counts errors and warnings separately from the passing checks", () => {
    // Uppercase name mismatching its folder: two errors. Unquoted description
    // with no 'when': two warnings. Everything else passes.
    const report = lintOf("name: BAD\ndescription: a thing", "\n# B\n", "s");
    expect(report.errors).toBe(report.findings.filter((f) => f.level === "error").length);
    expect(report.warnings).toBe(
      report.findings.filter((f) => f.level === "warn").length
    );
    expect(report.errors).toBeGreaterThan(0);
    expect(report.warnings).toBeGreaterThan(0);
    expect(report.errors + report.warnings).toBeLessThan(report.findings.length);
  });

  test("a clean skill counts zero of both", () => {
    const fm =
      'name: s\ndescription: "Does a thing. Use when asked."\nmetadata:\n  triggers:\n    - "s"\n    - "a thing"\n    - "do the thing"';
    const report = lintOf(fm);
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(0);
  });
});

describe("absolute-path reporting truncates", () => {
  function reportWith(hits: number) {
    counter += 1;
    const dir = resolve(ROOT, `abs-${counter}`, "s");
    mkdirSync(dir, { recursive: true });
    const lines = Array.from({ length: hits }, (_, i) => `/home/user${i}/x`).join("\n");
    writeFileSync(resolve(dir, "SKILL.md"), `---\nname: s\n---\n${lines}\n`);
    return lintSkill(dir);
  }

  function message(hits: number) {
    return reportWith(hits).findings.find((f) => f.check === "paths.absolute")?.message;
  }

  test("no absolute paths passes", () => {
    expect(levelOf(lintOf("name: s"), "paths.absolute")).toBe("pass");
  });

  // Exactly three fit; the fourth is the first that has to be counted instead.
  test("three hits are all shown with no overflow count", () => {
    const m = message(3);
    expect(m).toContain("/home/user0");
    expect(m).toContain("/home/user2");
    expect(m).not.toContain("more)");
  });

  test("beyond three, the rest are counted rather than listed", () => {
    const m = message(5);
    expect(m).toContain("/home/user2");
    expect(m).not.toContain("/home/user3");
    expect(m).toContain("(+2 more)");
  });
});

describe("reference depth", () => {
  /** The depth verdict, and a failure if the check reported more than once. */
  function refReport(files: Record<string, string>) {
    counter += 1;
    const dir = resolve(ROOT, `ref-${counter}`, "s");
    for (const [rel, content] of Object.entries(files)) {
      const target = resolve(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    const found = lintSkill(dir).findings.filter((f) => f.check === "references.depth");
    expect(found.length).toBe(1);
    return found[0].level;
  }

  const skill = (body: string) => `---\nname: s\n---\n${body}\n`;

  test("a skill with no references is one level deep", () => {
    expect(refReport({ "SKILL.md": skill("no links here") })).toBe("pass");
  });

  test("a reference that links no further is one level deep", () => {
    expect(
      refReport({
        "SKILL.md": skill("see [ref](ref.md)"),
        "ref.md": "a leaf with no links",
      })
    ).toBe("pass");
  });

  test("a reference that links onward is too deep", () => {
    expect(
      refReport({
        "SKILL.md": skill("see [ref](ref.md)"),
        "ref.md": "onward to [deeper](deeper.md)",
        "deeper.md": "leaf",
      })
    ).toBe("warn");
  });

  // A link back to the entry file is a return-link, not another level.
  test("a reference linking back to SKILL.md is not a further level", () => {
    expect(
      refReport({
        "SKILL.md": skill("see [ref](ref.md)"),
        "ref.md": "back to [start](SKILL.md)",
      })
    ).toBe("pass");
  });

  // Following SKILL.md's own self-link would find SKILL.md's other links and
  // report the skill as nested inside itself.
  test("SKILL.md linking to itself is not a further level", () => {
    expect(
      refReport({
        "SKILL.md": skill("[self](SKILL.md) and [ref](ref.md)"),
        "ref.md": "a leaf",
      })
    ).toBe("pass");
  });

  test("an external link is not a further level", () => {
    expect(
      refReport({
        "SKILL.md": skill("see [ref](ref.md)"),
        "ref.md": "see [spec](https://example.com/spec.md)",
      })
    ).toBe("pass");
  });

  test("a reference that does not exist on disk is skipped", () => {
    expect(refReport({ "SKILL.md": skill("see [gone](missing.md)") })).toBe("pass");
  });
});

describe("author voice is detected with either apostrophe", () => {
  const withDescription = (d: string) => lintOf(`name: s\ndescription: "${d}"`);

  test("a straight apostrophe in the description reads as first person", () => {
    expect(
      levelOf(withDescription("I'll do the thing when asked"), "description.pov")
    ).toBe("warn");
  });

  test("a curly apostrophe reads the same way", () => {
    expect(
      levelOf(withDescription("I’ll do the thing when asked"), "description.pov")
    ).toBe("warn");
    expect(
      levelOf(withDescription("you’ll do the thing when asked"), "description.pov")
    ).toBe("warn");
  });

  test("third person passes", () => {
    expect(
      levelOf(withDescription("Does the thing. Use when asked."), "description.pov")
    ).toBe("pass");
  });

  // Each phrase alone must trip the check, or one alternative masks the rest.
  test("the body is checked for author voice with either apostrophe too", () => {
    for (const phrase of ["I'm here", "I’m here", "I'll go", "I’ll go", "my workflow"]) {
      expect(levelOf(lintOf("name: s", `\n${phrase}\n`), "body.pov")).toBe("warn");
    }
    expect(levelOf(lintOf("name: s", "\nRead the input.\n"), "body.pov")).toBe("pass");
  });

  // Examples are not the author speaking.
  test("first person inside a code fence is not author voice", () => {
    expect(
      levelOf(lintOf("name: s", '\n```\necho "I will run"\n```\n'), "body.pov")
    ).toBe("pass");
  });
});

describe("description quoting needs a real pair", () => {
  // Two quotes and nothing else is still a pair: the value is the empty string.
  test("an empty quoted value is quoted", () => {
    const parsed = parseSkill('---\nname: x\ndescription: ""\n---\nbody\n');
    expect(parsed.descriptionQuoted).toBe(true);
    expect(parsed.description).toBe("");
  });
});

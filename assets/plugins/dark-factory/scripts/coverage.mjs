export function expectedInputs(transcripts, corrections) {
  return [
    ...transcripts.map((transcript) => transcript.path),
    ...corrections.flatMap((correction) =>
      correction.commits.map((commit) => commit.sha)
    ),
  ];
}

function normalClass(cls) {
  return String(cls ?? "")
    .trim()
    .toLowerCase();
}

function isValidVerdict(item, known) {
  if (item.verdict === "clean") return true;
  return item.verdict === "finding" && known.has(normalClass(item.class));
}

function problemOf(items) {
  if (items.length === 0) return "no verdict";
  return `unknown class "${items[0].class ?? ""}"`;
}

export function missingInputs({ expected, reviewed, knownClasses }) {
  const known = new Set(knownClasses.map(normalClass));
  return expected.flatMap((source) => {
    const items = reviewed.filter((item) => item.source === source);
    if (items.some((item) => isValidVerdict(item, known))) return [];
    return [{ source, problem: problemOf(items) }];
  });
}

function listOf(result, key) {
  return Array.isArray(result?.[key]) ? result[key] : [];
}

export function reviewedOf(result) {
  return listOf(result, "reviewed");
}

export function mergeCoachResults(first, second) {
  return {
    findings: [...listOf(first, "findings"), ...listOf(second, "findings")],
    updates: [...listOf(first, "updates"), ...listOf(second, "updates")],
    reviewed: [...reviewedOf(first), ...reviewedOf(second)],
  };
}

export function resumeInstructions(missing) {
  return [
    "Your result left out these inputs. Return a result with a reviewed item for each of them, and any findings or updates they lead to. Your earlier items are kept.",
    ...missing.map((item) => `- ${item.source}: ${item.problem}`),
  ].join("\n");
}

export function reviewedCount(expected, missing) {
  const missingSources = new Set(missing.map((item) => item.source));
  return [...new Set(expected)].filter((source) => !missingSources.has(source)).length;
}

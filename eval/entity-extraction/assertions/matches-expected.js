const parse = require("../../lib/parse-output");

const LEGAL_SUFFIX = /\b(kft|zrt|nyrt|bt|kkt|ltd|inc|llc|gmbh)\b/g;

function fold(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[.,&]/g, " ")
    .replace(LEGAL_SUFFIX, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sameName(a, b) {
  const [x, y] = [fold(a), fold(b)];
  if (x === y) return true;
  return x.split(" ").sort().join(" ") === y.split(" ").sort().join(" ");
}

function find(entities, name) {
  return entities.find((e) =>
    [e.name, ...(e.aliases ?? [])].some((n) => sameName(n, name))
  );
}

function says(value, expected) {
  return new RegExp(expected, "i").test(String(value ?? ""));
}

function presentProblems(entities, want) {
  const e = find(entities, want.name);
  if (!e) return [`missing ${want.name}`];
  const problems = [];
  if (want.kind && e.kind !== want.kind) problems.push(`${want.name}: kind ${e.kind}`);
  if (want.existing !== undefined && e.existing !== want.existing)
    problems.push(`${want.name}: existing "${e.existing}", wanted "${want.existing}"`);
  for (const field of ["role", "organization", "relation"]) {
    if (want[field] && !says(e[field], want[field]))
      problems.push(`${want.name}: ${field} "${e[field]}", wanted /${want[field]}/`);
  }
  return [...problems, ...aliasProblems(e, want), ...inventedProblems(e, want)];
}

function aliasProblems(e, want) {
  return (want.aliases ?? [])
    .filter((alias) => !(e.aliases ?? []).some((a) => sameName(a, alias)))
    .map((alias) => `${want.name}: no alias ${alias}`);
}

function inventedProblems(e, want) {
  return (want.empty ?? [])
    .filter((field) => String(e[field] ?? "").trim())
    .map((field) => `${want.name}: invented ${field} "${e[field]}"`);
}

module.exports = (output, context) => {
  const r = parse(output);
  if (!r || !Array.isArray(r.entities))
    return { pass: false, score: 0, reason: "no entities list" };
  const expect = context.vars.expect ?? {};
  const problems = [
    ...(expect.present ?? []).flatMap((want) => presentProblems(r.entities, want)),
    ...(expect.absent ?? [])
      .filter((name) => find(r.entities, name))
      .map((n) => `listed ${n}`),
  ];
  if (expect.none && r.entities.length > 0)
    problems.push(`listed ${r.entities.map((e) => e.name).join(", ")}`);
  return {
    pass: problems.length === 0,
    score: problems.length === 0 ? 1 : 0,
    reason: problems.join("; ") || "as expected",
  };
};

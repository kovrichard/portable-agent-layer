const parse = require("../../lib/parse-output");

function otherProblems(r) {
  const problems = [];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(r.suggested ?? "")))
    problems.push(`suggested "${r.suggested}" is not a kebab-case name`);
  if (!String(r.description ?? "").trim()) problems.push("other without a description");
  return problems;
}

module.exports = (output, context) => {
  const r = parse(output);
  if (!r || typeof r.kind !== "string")
    return { pass: false, score: 0, reason: "no kind" };
  const accepted = String(context.vars.expect).split("|");
  const problems = accepted.includes(r.kind)
    ? []
    : [`kind ${r.kind}, wanted ${accepted.join(" or ")}`];
  if (r.kind === "other") problems.push(...otherProblems(r));
  const shown = r.kind === "other" ? `other:${r.suggested}` : r.kind;
  return {
    pass: problems.length === 0,
    score: problems.length === 0 ? 1 : 0,
    reason: problems.join("; ") || shown,
  };
};

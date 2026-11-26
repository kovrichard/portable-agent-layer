const parse = require("../../lib/parse-output");

module.exports = (output, context) => {
  const r = parse(output);
  if (!r || typeof r.pal_bug !== "boolean")
    return { pass: false, score: 0, reason: "no pal_bug" };
  const wanted = context.vars.expect === "bug";
  const pass = r.pal_bug === wanted;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: `${r.pal_bug ? `bug:${r.surface}` : "no bug"}, wanted ${wanted ? "bug" : "no bug"}`,
  };
};

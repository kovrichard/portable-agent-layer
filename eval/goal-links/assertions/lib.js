const parse = require("../../lib/parse-output");
module.exports.linksOf = (output) => {
  const r = parse(output);
  if (!r || !Array.isArray(r.links)) return null;
  return Object.fromEntries(
    r.links.map((l) => [l.goalId, Array.isArray(l.projects) ? l.projects : []])
  );
};

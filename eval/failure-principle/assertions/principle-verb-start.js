const parse = require("../../lib/parse-output");
const NON_VERBS = new Set([
  "The",
  "A",
  "An",
  "I",
  "It",
  "This",
  "That",
  "When",
  "If",
  "To",
  "In",
  "For",
  "On",
  "With",
  "By",
  "From",
  "As",
  "At",
]);
module.exports = (output) => {
  const r = parse(output);
  if (!r || typeof r.principle !== "string") return false;
  const first = r.principle.trim().split(/\s+/)[0];
  return first.length > 0 && !NON_VERBS.has(first);
};

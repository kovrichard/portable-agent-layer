const parse = require("../../lib/parse-output");
module.exports = (output) => {
  const r = parse(output);
  return Boolean(r && typeof r.question === "string" && r.question.trim().length === 0);
};

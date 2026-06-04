const parse = require("../../lib/parse-output");
module.exports = (output) => {
  const r = parse(output);
  if (!r || typeof r.principle !== "string") return false;
  const count = r.principle.trim().split(/\s+/).length;
  return count >= 10 && count <= 20;
};

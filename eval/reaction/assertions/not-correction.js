const parse = require("../../lib/parse-output");
module.exports = (output) => {
  const reaction = parse(output)?.reaction;
  return typeof reaction === "string" && !["corrected", "repeated"].includes(reaction);
};

const parse = require("../../lib/parse-output");
module.exports = (output) => {
  const r = parse(output);
  return (
    r !== null &&
    typeof r.detailed_context === "string" &&
    r.detailed_context.trim().length >= 50
  );
};

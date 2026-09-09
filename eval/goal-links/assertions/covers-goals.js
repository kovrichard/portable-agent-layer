const { linksOf } = require("./lib");
module.exports = (output, context) => {
  const by = linksOf(output);
  if (!by) return false;
  const got = Object.keys(by).sort();
  const want = [...context.config.goalIds].sort();
  return JSON.stringify(got) === JSON.stringify(want);
};

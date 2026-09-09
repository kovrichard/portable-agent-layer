const { linksOf } = require("./lib");
module.exports = (output, context) => {
  const by = linksOf(output);
  return Boolean(by && (by[context.config.goalId] ?? []).length === 0);
};

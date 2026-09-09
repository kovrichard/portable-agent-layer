const { linksOf } = require("./lib");
module.exports = (output, context) => {
  const by = linksOf(output);
  if (!by) return false;
  return Object.entries(context.config ?? {}).every(([goalId, expected]) =>
    expected.every((slug) => (by[goalId] ?? []).includes(slug))
  );
};

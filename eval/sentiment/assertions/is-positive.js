const parse = require("./parse-output");
module.exports = (output) => {
  const r = parse(output);
  return r !== null && r.sentiment === "positive";
};

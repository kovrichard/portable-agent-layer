const { readFileSync } = require("node:fs");
const { join } = require("node:path");

module.exports = ({ vars }) =>
  readFileSync(join(__dirname, "generated", `${vars.fixture}.txt`), "utf8");

const parse = require("./parse-output");
module.exports = (output) => parse(output) !== null;

const parse = require("../../lib/parse-output");
module.exports = (output) => ["corrected", "repeated"].includes(parse(output)?.reaction);

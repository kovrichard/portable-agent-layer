const check = require("./check");

module.exports = (output, context) => check(output, context.vars.caseId, "next");

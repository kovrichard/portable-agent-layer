const parse = require("./parse-output");

/**
 * makeCheck(field, op, expected?) → promptfoo assertion function
 *
 * ops:
 *   'eq'       — r[field] === expected
 *   'ne'       — r[field] !== expected
 *   'null'     — r[field] === null
 *   'not-null' — r[field] !== null
 */
module.exports.makeCheck = function makeCheck(field, op, expected) {
  return (output) => {
    const r = parse(output);
    if (!r) return false;
    switch (op) {
      case "eq":
        return r[field] === expected;
      case "ne":
        return r[field] !== expected;
      case "null":
        return r[field] === null;
      case "not-null":
        return r[field] !== null;
      default:
        throw new Error(`Unknown op: ${op}`);
    }
  };
};

const parse = require("../../lib/parse-output");
const VERBS = new Set([
  "Verify",
  "Always",
  "Never",
  "Ask",
  "Check",
  "Confirm",
  "Read",
  "Avoid",
  "Ensure",
  "Test",
  "Run",
  "Prefer",
  "Use",
  "Stop",
  "Request",
  "Validate",
  "Review",
  "Require",
  "Make",
  "Keep",
  "Treat",
  "Do",
  "Don't",
]);
module.exports = (output) => {
  const r = parse(output);
  if (!r || typeof r.principle !== "string") return false;
  const first = r.principle.trim().split(/\s+/)[0];
  return VERBS.has(first);
};

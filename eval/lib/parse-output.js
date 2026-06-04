module.exports = function parseOutput(output) {
  if (typeof output === "object") return output;
  const m = /\{[\s\S]*\}/.exec(output);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
};

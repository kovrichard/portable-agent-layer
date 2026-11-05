const RUNTIME_MODEL_HEADING = /^#{1,3}\s*runtime model/i;
const LOCK = /\b(lock|locks|locking|lockfile|mutex|flock)\b/i;
const ONCE_PER = /once[- ]per[- ](task|run|item)/i;
const NO_SHARED_STATE =
  /no shared state|nothing (is )?shared|shares? no state|no state (is )?shared|no (concurrent|overlapping) runs/i;
const SECTIONS = {
  "criteria map": /^#{1,3}\s*criteria map/im,
  "must not add": /^#{1,3}\s*must[- ]not[- ]add/im,
  "runtime model": /^#{1,3}\s*runtime model/im,
};

function sectionAfter(output, headingPattern) {
  const lines = output.split("\n");
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) return "";
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("#")) break;
    body.push(line);
  }
  return body.join("\n");
}

const NEGATION = /\b(no|not|never|without|n't)\b/i;

function addedByStep(output, pattern) {
  return output
    .split("\n")
    .some((line) => pattern.test(line) && !NEGATION.test(line));
}

function inventedWork(output, runtimeModel) {
  const mustNotAdd = sectionAfter(output, SECTIONS["must not add"]);
  const planned = mustNotAdd ? output.replace(mustNotAdd, "") : output;
  if (addedByStep(planned, LOCK)) return "adds a lock";
  if (addedByStep(planned.replace(runtimeModel, ""), ONCE_PER))
    return "adds once-per bookkeeping";
  const filled = runtimeModel.split("\n").filter((line) => line.trim() !== "");
  if (filled.length > 6) return "runtime model longer than six lines";
  if (!NO_SHARED_STATE.test(runtimeModel))
    return "runtime model does not say there is no shared state";
  return null;
}

module.exports.hazard = (output, { vars }) => {
  if (vars.control) return true;
  const hit = [vars.hazard]
    .flat()
    .find((pattern) => new RegExp(pattern, "i").test(output));
  return {
    pass: Boolean(hit),
    score: hit ? 1 : 0,
    reason: hit ? `named: ${hit}` : "hazard not named",
  };
};

module.exports.sections = (output) => {
  const missing = Object.keys(SECTIONS).filter((name) => !SECTIONS[name].test(output));
  return {
    pass: missing.length === 0,
    score: missing.length === 0 ? 1 : 0,
    reason: missing.length === 0 ? "all sections" : `missing: ${missing.join(", ")}`,
  };
};

module.exports.control = (output, { vars }) => {
  if (!vars.control) return true;
  const failure = inventedWork(output, sectionAfter(output, RUNTIME_MODEL_HEADING));
  return {
    pass: failure === null,
    score: failure === null ? 1 : 0,
    reason: failure ?? "no invented work",
  };
};

function sectionAfter(output, heading) {
  const start = output.search(new RegExp(`^#+\\s*${heading}`, "im"));
  if (start === -1) return "";
  const body = output.slice(start).split("\n").slice(1).join("\n");
  const next = body.search(/^#+\s/m);
  return next === -1 ? body : body.slice(0, next);
}

function movesOf(output) {
  return sectionAfter(output, "Proposed moves")
    .split("\n")
    .filter((line) => /^\d+[.)]\s/.test(line));
}

function verdict(pass, reason) {
  return { pass, score: pass ? 1 : 0, reason };
}

// promptfoo runs a case once per element of a list-valued var, so a list of
// patterns is written as one string with ";" between the patterns.
function patternsIn(value) {
  return String(value ?? "")
    .split(";")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

function missingFrom(text, patterns) {
  return patterns.filter((pattern) => !new RegExp(pattern, "i").test(text));
}

module.exports.namesEverything = (output, { vars }) => {
  const missing = missingFrom(output, patternsIn(vars.mustName));
  return verdict(missing.length === 0, `missing: ${missing.join(", ") || "nothing"}`);
};

module.exports.rankingStartsWithTopUnit = (output, { vars }) => {
  const firstRow = sectionAfter(output, "Ranking")
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2, 3)
    .join("");
  const hit = new RegExp(vars.firstRow, "i").test(firstRow);
  return verdict(hit, `first ranking row: ${firstRow || "(none)"}`);
};

module.exports.oneMoveForTheTopCause = (output, { vars }) => {
  const moves = movesOf(output);
  const hit = moves.length === 1 && new RegExp(vars.topCause, "i").test(moves[0]);
  return verdict(hit, `${moves.length} move(s): ${moves.join(" / ") || "(none)"}`);
};

module.exports.noMoveForMinorCauses = (output, { vars }) => {
  const moves = sectionAfter(output, "Proposed moves");
  const named = patternsIn(vars.minor).filter((pattern) =>
    new RegExp(pattern, "i").test(moves)
  );
  return verdict(
    named.length === 0,
    `minor causes in moves: ${named.join(", ") || "none"}`
  );
};

module.exports.stopsForApproval = (output) => {
  const closing = output.trim().split("\n").slice(-3).join(" ");
  const hit =
    /nothing (has been|was|is) changed/i.test(closing) && /approv/i.test(closing);
  return verdict(hit, `closing: ${closing}`);
};

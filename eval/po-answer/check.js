const parse = require("../lib/parse-output");

function dispositionOf(reply) {
  if (reply?.userQuestion) return "escalate";
  if (reply?.answer) return "answer";
  return "none";
}

module.exports.disposition = (output, { vars }) => {
  const got = dispositionOf(parse(output));
  return {
    pass: got === vars.expected,
    score: got === vars.expected ? 1 : 0,
    reason: `got ${got}`,
  };
};

module.exports.mentions = (output, { vars }) => {
  if (!vars.mustMention) return true;
  const text = JSON.stringify(parse(output) ?? {}).toLowerCase();
  const hit = text.includes(vars.mustMention.toLowerCase());
  return {
    pass: hit,
    score: hit ? 1 : 0,
    reason: hit ? "mentioned" : `missing ${vars.mustMention}`,
  };
};

module.exports.recommends = (output) => {
  const reply = parse(output);
  if (!reply?.userQuestion) return true;
  const hit = /recommend/i.test(reply.userQuestion);
  return {
    pass: hit,
    score: hit ? 1 : 0,
    reason: hit ? "recommends" : "no recommended option",
  };
};

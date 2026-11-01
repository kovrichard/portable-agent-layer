export const meta = {
  name: "scientific-research",
  description:
    "Complex scientific question: parallel source lanes, then verifiers; only confirmed claims come back",
  whenToUse:
    "Run by the scientific-research skill for a complex question, with the briefs from its SKILL.md in args",
  phases: [{ title: "Lanes" }, { title: "Verify" }],
};

const CLAIMS_PER_VERIFIER = 20;

const LANE_SCHEMA = {
  type: "object",
  required: ["inaccessible", "claims", "nothingFound", "searched"],
  properties: {
    inaccessible: { type: "boolean" },
    claims: {
      type: "array",
      items: {
        type: "object",
        required: ["claim", "population", "effect", "evidenceLevel", "year", "citation"],
        properties: {
          claim: { type: "string" },
          population: { type: "string" },
          effect: { type: "string" },
          evidenceLevel: { type: "string" },
          year: { type: "string" },
          citation: { type: "string" },
        },
      },
    },
    nothingFound: { type: "array", items: { type: "string" } },
    searched: { type: "array", items: { type: "string" } },
  },
};

const VERIFIER_SCHEMA = {
  type: "object",
  required: ["verdicts", "contradictions"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "confirmed", "reason"],
        properties: {
          id: { type: "string" },
          confirmed: { type: "boolean" },
          reason: { type: "string" },
        },
      },
    },
    contradictions: {
      type: "array",
      items: {
        type: "object",
        required: ["ids", "whoSaysWhat", "likelyReason"],
        properties: {
          ids: { type: "array", items: { type: "string" } },
          whoSaysWhat: { type: "string" },
          likelyReason: { type: "string" },
        },
      },
    },
  },
};

function laneBrief(lane) {
  return args.laneBrief.replace("{{LANE}}", `${lane.id} — ${lane.description}`);
}

function verifierBrief(claims) {
  return args.verifierBrief.replace("{{FINDINGS}}", JSON.stringify(claims, null, 2));
}

function numberClaims(laneId, result) {
  return result.claims.map((claim, index) => ({ id: `${laneId}${index + 1}`, lane: laneId, ...claim }));
}

function chunk(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size)
  );
}

phase("Lanes");
const laneResults = await parallel(
  args.lanes.map((lane) => () =>
    agent(laneBrief(lane), { label: `lane ${lane.id}`, phase: "Lanes", schema: LANE_SCHEMA }).then(
      (result) => result && { lane: lane.id, ...result }
    )
  )
);
const lanes = laneResults.filter(Boolean);
const failedLanes = args.lanes.map((lane) => lane.id).filter((id) => !lanes.some((l) => l.lane === id));
const claims = lanes.flatMap((lane) => numberClaims(lane.lane, lane));
log(`${claims.length} claims from ${lanes.length} lanes`);

phase("Verify");
const verifierResults = claims.length
  ? (
      await parallel(
        chunk(claims, CLAIMS_PER_VERIFIER).map((batch, index) => () =>
          agent(verifierBrief(batch), { label: `verifier ${index + 1}`, phase: "Verify", schema: VERIFIER_SCHEMA })
        )
      )
    ).filter(Boolean)
  : [];

const verdictById = new Map(verifierResults.flatMap((r) => r.verdicts).map((v) => [v.id, v]));
const isConfirmed = (claim) => verdictById.get(claim.id)?.confirmed === true;
const unverifiedReason = (claim) => verdictById.get(claim.id)?.reason ?? "no verifier verdict";

return {
  confirmed: claims.filter(isConfirmed),
  couldNotVerify: claims.filter((c) => !isConfirmed(c)).map((c) => ({ ...c, reason: unverifiedReason(c) })),
  contradictions: verifierResults.flatMap((r) => r.contradictions),
  nothingFound: lanes.flatMap((lane) => lane.nothingFound.map((gap) => `${lane.lane}: ${gap}`)),
  inaccessibleLanes: lanes.filter((lane) => lane.inaccessible).map((lane) => lane.lane),
  failedLanes,
  sourcesOpened: lanes.flatMap((lane) => lane.searched).length,
};

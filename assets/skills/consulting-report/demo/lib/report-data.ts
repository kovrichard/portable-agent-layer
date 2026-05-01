export interface Finding {
  id: string;
  title: string;
  description: string;
  evidence: string;
  source: string;
  severity: "critical" | "high" | "medium" | "low";
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  priority: "immediate" | "short-term" | "long-term";
}

export interface TimelinePhase {
  phase: string;
  title: string;
  description: string;
  duration: string;
}

export interface ReportData {
  clientName: string;
  reportTitle: string;
  reportDate: string;
  classification: string;
  consultancyName: string;
  preTitle?: string;

  executiveSummary: {
    context: string;
    methodology: { interviewCount: number; roles: string[] };
    keyFindings: string[];
    primaryRecommendation: string;
    expectedOutcomes: string[];
  };

  situationAssessment: {
    currentState: string;
    clientAsk: string;
    whyNow: string;
  };

  findings: Finding[];

  riskAnalysis: {
    existentialRisks: string[];
    competitiveThreats: string[];
    timelinePressures: string;
  };

  strategicOpportunity: {
    goodNews: string;
    requirements: string[];
  };

  recommendations: Recommendation[];

  targetState: {
    description: string;
    keyCapabilities: string[];
    successMetrics: string[];
  };

  roadmap: TimelinePhase[];

  callToAction: {
    immediateSteps: string[];
    decisionPoints: string[];
    commitmentRequired: string;
  };
}

export const reportData: ReportData = {
  clientName: "Acme Industries",
  reportTitle: "Operational Readiness Assessment",
  reportDate: "April 21, 2026",
  classification: "CONFIDENTIAL",
  consultancyName: "Konvert7 Consulting",
  preTitle: "Operational Assessment",

  executiveSummary: {
    context:
      "Acme Industries asked for an independent read on whether their engineering operations are ready to support the 3× revenue growth planned over the next 18 months. The assessment ran for six weeks and covered tier-1 production services, on-call practice, and incident response.",
    methodology: {
      interviewCount: 5,
      roles: ["Head of Platform", "SRE Lead", "Senior Engineers (3)", "VP Engineering"],
    },
    keyFindings: [
      "Production deploys lack a tested rollback path — the single largest operational risk.",
      "Runbooks are stale across half of tier-1 services.",
      "On-call coverage is concentrated in three engineers; knowledge has not diffused.",
    ],
    primaryRecommendation:
      "Add a tested rollback gate to the production deploy pipeline within four weeks. It is the single highest-leverage operational fix available and unblocks the rest of the readiness work.",
    expectedOutcomes: [
      "Mean time to recovery within 1.5× peer benchmark by end of Q3",
      "Zero production deploys without a successful rollback dry-run in staging",
      "On-call coverage spread across 8 engineers within six months",
    ],
  },

  situationAssessment: {
    clientAsk:
      "An independent read on whether engineering operations are ready to support the planned 3× revenue ramp over the next 18 months.",
    currentState:
      "Engineering operations are competent but carry three structural gaps: an untested rollback path in production, stale runbooks across half of tier-1 services, and dangerous concentration of on-call coverage in three engineers. MTTR is currently running at 3× peer benchmarks.",
    whyNow:
      "The 3× revenue ramp begins in Q3 2026 and pulls forward operational scale that today's processes cannot absorb. Each gap that goes into Q3 unaddressed compounds under load — the cost of remediation rises sharply once growth begins.",
  },

  findings: [
    {
      id: "F1",
      title: "Release pipeline lacks a rollback path",
      description:
        "Production deploys are one-way: the pipeline lacks a tested rollback step. Of the last 12 incidents, 4 required manual database surgery because the deploy couldn't be reverted.",
      evidence:
        "Mean time to recovery is 3× peer benchmarks, and engineers report avoiding late-week deploys — slowing feature delivery.",
      source: "Pipeline review + Q1 incident post-mortems (12)",
      severity: "critical",
    },
    {
      id: "F2",
      title: "Runbooks are out of date across half the critical services",
      description:
        "7 of 14 tier-1 services have runbooks last updated more than 18 months ago. Three of those services have been re-architected since.",
      evidence:
        "Runbook inventory: 5 fresh (≤6 months), 2 aging (6–18 months), 7 stale (>18 months).",
      source: "Runbook inventory audit",
      severity: "high",
    },
    {
      id: "F3",
      title: "On-call rotation is concentrated in three engineers",
      description:
        "Over the last quarter, three engineers covered 71% of the on-call minutes. The shadow-rotation system exists on paper but is not enforced.",
      evidence:
        "Engineer A: 28%, Engineer B: 24%, Engineer C: 19%. Remaining 8 engineers split 29%. Zero shadow rotations completed in the last two quarters.",
      source: "On-call coverage logs (90 days)",
      severity: "medium",
    },
  ],

  riskAnalysis: {
    existentialRisks: [
      "Production deploys with no rollback path during the growth ramp — a single bad deploy at peak load could require live database surgery during the busiest hour.",
      "Knowledge concentration in three engineers means a single departure or unavailability event compromises incident response across half the platform.",
    ],
    competitiveThreats: [
      "MTTR running at 3× peer benchmarks materially limits feature velocity at exactly the moment competitors are accelerating.",
      "Engineers self-report avoiding late-week deploys; growth requires the opposite — confidence to deploy at any time.",
    ],
    timelinePressures:
      "The Q3 2026 ramp begins in roughly three months. Operational fixes that take a sprint today take a quarter once the team is also absorbing 3× load.",
  },

  strategicOpportunity: {
    goodNews:
      "All three findings are process gaps, not capability gaps. The team is competent and well-intentioned — the fixes don't require new hires, only sequencing and leadership commitment.",
    requirements: [
      "Treat the rollback gate as a P0 platform initiative, not a sprint task",
      "Create a cross-team runbook refresh ritual that doesn't depend on individual heroics",
      "Make on-call rotation breadth a leadership-tracked KPI",
    ],
  },

  recommendations: [
    {
      id: "R1",
      title: "Add a tested rollback gate to the deploy pipeline",
      description:
        "Before any production deploy, require a successful rollback dry-run in staging. Block the pipeline on red. Validate monthly via chaos day. Owner: Platform team. Target: implemented within 4 weeks.",
      priority: "immediate",
    },
    {
      id: "R2",
      title: "Runbook refresh sprint",
      description:
        "Allocate one sprint in Q3 to refresh all tier-1 runbooks. Each owner writes a 10-minute 'what wakes me up at 3am' paragraph. Reviewed as pair exercise with on-call. Owner: Service owners + SRE.",
      priority: "short-term",
    },
    {
      id: "R3",
      title: "Broaden on-call to 8 engineers within 6 months",
      description:
        "Rotate 2 new engineers through a 4-week shadow period each quarter. Gate solo rotation on a resolved-incident checklist, not tenure.",
      priority: "long-term",
    },
  ],

  targetState: {
    description:
      "Engineering operations that can absorb 3× load without operator heroics — every tier-1 service has a fresh runbook, every production deploy has a tested rollback, and on-call is a shared discipline rather than a three-person tax.",
    keyCapabilities: [
      "Single-command rollback validated monthly",
      "Tier-1 runbook freshness as a service-owner KPI",
      "8-engineer on-call rotation with a tracked shadow program",
    ],
    successMetrics: [
      "MTTR within 1.5× peer benchmark",
      "Zero deploys without successful rollback dry-run in staging",
      "No engineer carries more than 15% of monthly on-call minutes",
    ],
  },

  roadmap: [
    {
      phase: "Phase 1",
      title: "Rollback Gate",
      description:
        "Implement and validate the tested rollback step in the production pipeline. Block deploys that haven't passed the rollback dry-run.",
      duration: "Weeks 1-4",
    },
    {
      phase: "Phase 2",
      title: "Runbook Refresh",
      description:
        "Q3 dedicated sprint refreshing all tier-1 runbooks with current architecture and on-call pair review.",
      duration: "Weeks 5-12",
    },
    {
      phase: "Phase 3",
      title: "On-Call Broadening",
      description:
        "Run two cohorts of shadow rotations; reach 8-engineer coverage with tracked solo-readiness checklist.",
      duration: "Weeks 13-26",
    },
  ],

  callToAction: {
    immediateSteps: [
      "Approve P0 status for the rollback gate initiative",
      "Block the first runbook refresh sprint slot in Q3",
      "Identify the five engineers entering shadow rotation in Q3",
    ],
    decisionPoints: [
      "Approve dedicated platform-team capacity for the rollback gate",
      "Approve sprint allocation for the Q3 runbook refresh",
      "Approve the on-call expansion target of 8 engineers",
    ],
    commitmentRequired:
      "Treat operational readiness as a leadership priority through Q4. Without sustained executive attention, the rollback gate ships and then drifts; the runbook refresh becomes one-time. The discipline must be visible from the top.",
  },
};

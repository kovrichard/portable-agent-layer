// Default placeholder report data.
//
// Each scaffolded project should REPLACE the contents of this file with its
// own data. The shapes are defined in ./types.ts — only the data lives here.
//
// The scaffold tool substitutes [CLIENT NAME] and "Strategic Assessment &
// Transformation Roadmap" when --client and --title are provided.
//
// Re-export the types from ./types here as well, so reports that import from
// "@/lib/report-data" continue to work.

export type {
  ConfigurationParameter,
  Dimension,
  Finding,
  Recommendation,
  ReportData,
  RubricLevel,
  Scorecard,
  ScorecardGate,
  ScorecardScore,
  TimelinePhase,
  TuningLogEntry,
} from "./types";

import type { ReportData } from "./types";

export const reportData: ReportData = {
  clientName: "[CLIENT NAME]",
  reportTitle: "Strategic Assessment & Transformation Roadmap",
  reportDate: new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }),
  classification: "CONFIDENTIAL",
  consultancyName: "[YOUR CONSULTANCY]",
  preTitle: "Strategic Assessment",

  executiveSummary: {
    context:
      "This report presents findings from a comprehensive assessment of [CLIENT], conducted to evaluate strategic readiness and identify transformation opportunities.",
    methodology: {
      interviewCount: 0,
      roles: ["Executive Leadership", "Department Heads", "Team Leads"],
    },
    keyFindings: [
      "Finding 1 — replace with actual finding",
      "Finding 2 — replace with actual finding",
      "Finding 3 — replace with actual finding",
    ],
    primaryRecommendation: "Based on this analysis, [PRIMARY RECOMMENDATION HERE]",
    expectedOutcomes: ["Expected outcome 1", "Expected outcome 2", "Expected outcome 3"],
  },

  situationAssessment: {
    currentState: "Replace with current state analysis.",
    clientAsk: "Replace with what the client originally asked for.",
    whyNow: "Replace with why this matters now — the underlying drivers.",
  },

  findings: [
    {
      id: "F1",
      title: "Finding Title",
      description: "Description of the finding.",
      evidence: "Evidence supporting this finding.",
      source: "Interview / data / observation",
      severity: "critical",
    },
  ],

  riskAnalysis: {
    existentialRisks: ["Replace with existential risks"],
    competitiveThreats: ["Replace with competitive threats"],
    timelinePressures: "Replace with timeline pressures and urgency factors.",
  },

  strategicOpportunity: {
    goodNews: "Replace with the strategic pivot — the path forward.",
    requirements: ["Requirement 1", "Requirement 2", "Requirement 3"],
  },

  recommendations: [
    {
      id: "R1",
      title: "Primary Recommendation",
      description: "Description of the recommendation.",
      priority: "immediate",
    },
  ],

  targetState: {
    description: "Replace with the vision description.",
    keyCapabilities: ["Capability 1", "Capability 2", "Capability 3"],
    successMetrics: ["Metric 1", "Metric 2", "Metric 3"],
  },

  roadmap: [
    {
      phase: "Phase 1",
      title: "Foundation",
      description: "Initial phase description.",
      duration: "Weeks 1-4",
    },
    {
      phase: "Phase 2",
      title: "Implementation",
      description: "Main implementation phase.",
      duration: "Weeks 5-12",
    },
    {
      phase: "Phase 3",
      title: "Optimization",
      description: "Optimization and scaling.",
      duration: "Weeks 13-20",
    },
  ],

  callToAction: {
    immediateSteps: ["Immediate next step 1", "Immediate next step 2"],
    decisionPoints: [
      "Decision point 1 requiring leadership approval",
      "Decision point 2",
    ],
    commitmentRequired: "Replace with the commitment required.",
  },
};

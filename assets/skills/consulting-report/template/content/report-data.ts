import type { ConsultingReport } from "{{TOOL_PATH}}";

const report: ConsultingReport = {
  clientName: "{{CLIENT_NAME}}",
  reportTitle: "{{REPORT_TITLE}}",
  reportDate: "{{DATE}}",
  classification: "CONFIDENTIAL",
  version: "0.1",

  // Brand is optional — defaults to Konvert7. Override per report if needed:
  // brand: { businessName: "Konvert7", logoPath: "/absolute/path/to/logo.png", brandLabel: "Strategic Assessment" },

  sections: [
    {
      id: "executive-summary",
      title: "Executive Summary",
      content: "executive-summary.md",
    },
    // Add sections — each `content` is either an inline markdown string OR a
    // .md filename relative to this content/ directory.
  ],

  // Optional. Delete the block if unused.
  findings: [
    // {
    //   id: "f-01",
    //   title: "Example critical finding",
    //   severity: "critical",
    //   evidence: "What was observed, with specifics.",
    //   impact: "Why it matters.",
    // },
  ],

  // Optional.
  recommendations: [
    // {
    //   id: "r-01",
    //   title: "Example recommendation",
    //   priority: "immediate",
    //   detail: "What to do, by when, and why.",
    //   owner: "Team or person",
    // },
  ],

  // Optional.
  conclusion: {
    // assessorNote: "Personal assessor voice.",
    // contextNote: "Situational context the reader needs.",
    // closingRemarks: "Where to go next.",
  },

  // Optional. Appendix — keyed by heading, each value is a list of bullets.
  // supportingEvidence: {
  //   "Interviews": ["Person A — 45m", "Person B — 30m"],
  //   "Documents reviewed": ["doc-1.pdf", "doc-2.md"],
  // },
};

export default report;

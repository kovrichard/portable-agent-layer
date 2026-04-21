import type { ConsultingReport } from "../../tools/generate-pdf";

const report: ConsultingReport = {
  clientName: "Acme Industries",
  reportTitle: "Operational Readiness Assessment",
  reportDate: "2026-04-21",
  classification: "CONFIDENTIAL",
  version: "1.0",

  // No brand block — uses the Konvert7 default.

  sections: [
    {
      id: "executive-summary",
      title: "Executive Summary",
      content: "executive-summary.md",
    },
    {
      id: "current-state",
      title: "Current State",
      content: "current-state.md",
    },
  ],

  findings: [
    {
      id: "f-01",
      title: "Release pipeline lacks a rollback path",
      severity: "critical",
      evidence:
        "Production deploys are one-way: the pipeline lacks a tested rollback step. Of the last 12 incidents, 4 required manual database surgery because the deploy couldn't be reverted.",
      impact:
        "Mean time to recovery is 3× peer benchmarks, and engineers report avoiding late-week deploys — slowing feature delivery.",
    },
    {
      id: "f-02",
      title: "Runbooks are out of date across half the critical services",
      severity: "high",
      evidence:
        "7 of 14 tier-1 services have runbooks last updated more than 18 months ago. Three of those services have been re-architected since.",
    },
    {
      id: "f-03",
      title: "On-call rotation is concentrated in three engineers",
      severity: "medium",
      evidence:
        "Over the last quarter, three engineers covered 71% of the on-call minutes. The shadow-rotation system exists on paper but isn't enforced.",
    },
  ],

  recommendations: [
    {
      id: "r-01",
      title: "Add a tested rollback gate to the deploy pipeline",
      priority: "immediate",
      detail:
        "Before any production deploy, require a successful rollback dry-run in staging. Block the pipeline on red. Target: implemented within 4 weeks; validated monthly via chaos day.",
      owner: "Platform team",
    },
    {
      id: "r-02",
      title: "Runbook refresh sprint",
      priority: "short-term",
      detail:
        "Allocate one sprint in Q3 to refresh all tier-1 runbooks. Each owner writes a 10-minute 'what wakes me up at 3am' paragraph. Review as pair exercise with oncall.",
      owner: "Service owners + SRE",
    },
    {
      id: "r-03",
      title: "Broaden on-call to 8 engineers within 6 months",
      priority: "long-term",
      detail:
        "Rotate 2 new engineers through a 4-week shadow period each quarter. Gate solo rotation on a resolved-incident checklist, not tenure.",
    },
  ],

  conclusion: {
    assessorNote:
      "The team is competent and well-intentioned; the gaps are process, not ability. The critical finding around rollback is the single highest-leverage fix available.",
    contextNote:
      "This assessment was scoped to engineering operations. Product, sales, and finance processes were out of scope but came up repeatedly in interviews as related bottlenecks.",
    closingRemarks:
      "A 30-day follow-up is recommended after the rollback gate lands to verify MTTR trend.",
  },

  supportingEvidence: {
    Interviews: [
      "Head of Platform — 45m",
      "SRE Lead — 45m",
      "Three senior engineers — 30m each",
      "VP Engineering — 30m",
    ],
    "Documents reviewed": [
      "Q1 incident post-mortems (12)",
      "On-call schedule & coverage logs (90 days)",
      "Current runbook index",
    ],
  },
};

export default report;

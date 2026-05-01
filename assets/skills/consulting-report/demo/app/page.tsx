import { AlertTriangle, CheckCircle2, Lightbulb, Target } from "lucide-react";
import { Callout } from "@/components/callout";
import { CoverPage } from "@/components/cover-page";
import { Exhibit } from "@/components/exhibit";
import { FindingCard } from "@/components/finding-card";
import { RecommendationCard } from "@/components/recommendation-card";
import { Section } from "@/components/section";
import { Timeline } from "@/components/timeline";
import { reportData } from "@/lib/report-data";

export default function ReportPage() {
  const data = reportData;

  return (
    <div>
      <CoverPage
        clientName={data.clientName}
        reportTitle={data.reportTitle}
        reportDate={data.reportDate}
        classification={data.classification}
        consultancyName={data.consultancyName}
        preTitle={data.preTitle}
      />

      <div className="report-container">
        <Section title="Executive Summary">
          <p className="text-lg mb-6">{data.executiveSummary.context}</p>

          <Exhibit number={1} title="Assessment Methodology">
            <div className="flex items-start gap-8">
              <div>
                <p className="text-3xl font-bold text-primary">
                  {data.executiveSummary.methodology.interviewCount}
                </p>
                <p className="text-sm text-muted">Interviews Conducted</p>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground mb-2">
                  Roles Interviewed:
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {data.executiveSummary.methodology.roles.map((role) => (
                    <p key={role} className="text-sm text-muted">
                      {role}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </Exhibit>

          <Exhibit number={2} title="Key Findings Summary">
            <ul className="space-y-2">
              {data.executiveSummary.keyFindings.map((finding, i) => (
                <li key={finding} className="flex items-start gap-3">
                  <span className="text-primary font-bold font-sans">{i + 1}.</span>
                  <span>{finding}</span>
                </li>
              ))}
            </ul>
          </Exhibit>

          <Callout label="Primary Recommendation">
            {data.executiveSummary.primaryRecommendation}
          </Callout>

          <h3 className="text-lg font-semibold mt-6 mb-3">Expected Outcomes</h3>
          <ul className="space-y-2">
            {data.executiveSummary.expectedOutcomes.map((outcome) => (
              <li key={outcome} className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                <span>{outcome}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Situation Assessment">
          <div className="grid gap-6">
            <div>
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                What You Asked For
              </h3>
              <p>{data.situationAssessment.clientAsk}</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-2">Current State</h3>
              <p>{data.situationAssessment.currentState}</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-2">Why This Matters Now</h3>
              <p>{data.situationAssessment.whyNow}</p>
            </div>
          </div>
        </Section>

        <Section title="Key Findings">
          <p className="text-muted mb-6">
            Our analysis identified {data.findings.length} significant findings that
            require attention. Each finding is supported by evidence gathered during our
            assessment.
          </p>
          <div className="space-y-4">
            {data.findings.map((finding, index) => (
              <FindingCard key={finding.id} finding={finding} index={index} />
            ))}
          </div>
        </Section>

        <Section title="Risk Analysis">
          <div className="grid gap-6">
            <Exhibit number={3} title="Existential Risks">
              <div className="space-y-3">
                {data.riskAnalysis.existentialRisks.map((risk) => (
                  <div
                    key={risk}
                    className="flex items-start gap-3 p-3 bg-destructive/5 rounded-lg border border-destructive/20"
                  >
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    <span>{risk}</span>
                  </div>
                ))}
              </div>
            </Exhibit>

            <Exhibit number={4} title="Competitive Threats">
              <ul className="space-y-2">
                {data.riskAnalysis.competitiveThreats.map((threat, i) => (
                  <li key={threat} className="flex items-start gap-3">
                    <span className="text-warning font-bold font-sans">{i + 1}.</span>
                    <span>{threat}</span>
                  </li>
                ))}
              </ul>
            </Exhibit>

            <div>
              <h3 className="text-lg font-semibold mb-2">Timeline Pressures</h3>
              <p>{data.riskAnalysis.timelinePressures}</p>
            </div>
          </div>
        </Section>

        <Section title="Strategic Opportunity">
          <Callout label="The Path Forward">{data.strategicOpportunity.goodNews}</Callout>

          <h3 className="text-lg font-semibold mt-6 mb-3 flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-accent" />
            What This Requires
          </h3>
          <ul className="space-y-3">
            {data.strategicOpportunity.requirements.map((req, i) => (
              <li
                key={req}
                className="flex items-start gap-3 p-3 bg-accent/5 rounded-lg border border-accent/20"
              >
                <span className="text-accent font-bold font-sans">{i + 1}.</span>
                <span>{req}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Strategic Recommendations">
          <p className="text-muted mb-6">
            Recommendations are prioritized by urgency and impact.
          </p>
          <div className="space-y-4">
            {data.recommendations.map((rec, index) => (
              <RecommendationCard key={rec.id} recommendation={rec} index={index} />
            ))}
          </div>
        </Section>

        <Section title="Target State Vision">
          <p className="text-lg mb-6">{data.targetState.description}</p>

          <Exhibit number={5} title="Key Capabilities Enabled">
            <div className="grid md:grid-cols-3 gap-4">
              {data.targetState.keyCapabilities.map((capability) => (
                <div
                  key={capability}
                  className="p-4 bg-success/5 rounded-lg border border-success/20 text-center"
                >
                  <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2" />
                  <span className="font-medium">{capability}</span>
                </div>
              ))}
            </div>
          </Exhibit>

          <h3 className="text-lg font-semibold mt-6 mb-3">Success Metrics</h3>
          <ul className="space-y-2">
            {data.targetState.successMetrics.map((metric) => (
              <li key={metric} className="flex items-center gap-3">
                <span className="w-2 h-2 bg-primary rounded-full" />
                <span>{metric}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Implementation Roadmap">
          <p className="text-muted mb-6">
            The transformation should be executed in phases, with clear milestones and
            decision points.
          </p>
          <Exhibit number={6} title="Phased Implementation Plan">
            <Timeline phases={data.roadmap} />
          </Exhibit>
        </Section>

        <Section title="Call to Action">
          <div className="bg-primary/5 rounded-2xl p-8 border border-primary/20">
            <h3 className="text-xl font-semibold mb-4">Immediate Next Steps</h3>
            <ol className="space-y-3 mb-6">
              {data.callToAction.immediateSteps.map((step, i) => (
                <li key={step} className="flex items-start gap-3">
                  <span className="shrink-0 w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center font-bold text-sm">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>

            <h3 className="text-xl font-semibold mb-4">Decision Points Required</h3>
            <ul className="space-y-2 mb-6">
              {data.callToAction.decisionPoints.map((point) => (
                <li key={point} className="flex items-center gap-3">
                  <span className="w-2 h-2 bg-accent rounded-full" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <Callout label="Commitment Required">
              {data.callToAction.commitmentRequired}
            </Callout>
          </div>
        </Section>

        <div className="mt-12 pt-8 border-t border-border text-center text-sm text-muted">
          <p className="font-semibold text-foreground mb-1">{data.classification}</p>
          <p>
            This report was prepared for {data.clientName} and contains confidential
            information.
          </p>
          <p className="mt-2">{data.reportDate}</p>
        </div>
      </div>
    </div>
  );
}

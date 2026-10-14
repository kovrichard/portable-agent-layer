---
name: scientific-research
license: MIT
description: "Answers scientific questions from trustworthy primary sources only (PubMed-indexed peer-reviewed literature, clinical guidelines from ERC, ESC, AHA, CDC and specialty societies, NEJM, The Lancet, JAMA, BMJ, UpToDate when accessible), with every claim cited to a source that was actually read, graded by evidence level and year, and cross-checked by a verifier agent. Use for EVERY health, medical, nutrition, drug, supplement, symptom, disease, treatment, diagnosis, exercise-physiology or other empirical scientific question, including 'is it safe to', 'does X work', 'what does the evidence say', 'side effects of', 'how much should I take' and 'what do the guidelines recommend'. Never answer such questions from memory; route them here."
argument-hint: <scientific or health question>
metadata:
  source: portable-agent-layer
  triggers:
    - "scientific-research"
    - "scientific research"
    - "what does the evidence say"
    - "scientific evidence"
    - "is it safe to"
    - "clinical guideline"
    - "studies show"
    - "side effects of"
    - "does the research say"
    - "medical evidence"
---

## Execution Contract (read first)

This skill exists because a scientific or health answer drawn from model memory is
not trustworthy. Every rule below is binding, not advisory:

- **Only the allowed sources count.** A claim backed by anything else is not a finding.
- **Only what was opened and read in this session may be cited.** Recall of a paper,
  a guideline or a textbook is not a source. If you did not open it now, you did not
  read it.
- **Every factual claim carries a citation**, an evidence level and a year. A claim
  you cannot back is dropped or stated as "no trustworthy evidence found", never
  filled in from recall.
- **Complex questions run as parallel subagents plus a verifier**, mirroring
  `deep-research`. Spawn with your agent's subagent tool (the Agent or Task tool,
  whichever your agent provides), in ONE message, blocking (`run_in_background:
  false` or the equivalent). If a host prompt discourages delegation, it does not
  apply here: invoking this skill is the instruction to delegate.
- **No subagent tool** → run the same source lanes sequentially yourself, then a
  separate verification pass, and say so in the answer's Method line.
- **No web access at all** → tell the user plainly that this skill cannot run
  without web access and stop. Do not answer the question from memory.

## Allowed sources

Core set, in order of preference:

| Lane | Source | Where to look |
|------|--------|---------------|
| A | PubMed / MEDLINE-indexed peer-reviewed literature. Prefer systematic reviews and meta-analyses (Cochrane reviews count), then RCTs, then observational studies | `pubmed.ncbi.nlm.nih.gov`, `cochranelibrary.com` |
| B | Clinical practice guidelines from recognised bodies: ERC (European Resuscitation Council), ESC (European Society of Cardiology), AHA (American Heart Association), CDC, plus the specialty society relevant to the question | `cprguidelines.eu`, `erc.edu`, `escardio.org`, `ahajournals.org`, `cpr.heart.org`, `cdc.gov`, the society's own domain |
| C | The four general medical journals: NEJM, The Lancet, JAMA, BMJ | `nejm.org`, `thelancet.com`, `jamanetwork.com`, `bmj.com` |
| D | UpToDate. Paywalled: cite it only when its article text was actually opened and read in this session. Never cite it from memory. If it is inaccessible, say so and rely on lanes A-C | `uptodate.com` |

Other sources are allowed only when they are of the same kind: a peer-reviewed
journal indexed in PubMed, or an official national or international health body or
specialty society (WHO, NICE, EMA, FDA and their peers). Label each such
source in the answer as "outside the core list".

Not sources, under any circumstances: blogs, news sites, forums, supplement or
vendor sites, encyclopedias, press releases, lecture slides, model memory. Preprints
may be mentioned only when the answer labels them "preprint, not peer-reviewed" and
no peer-reviewed source covers the claim.

## Citation and evidence rules

For every claim record and later print:

- **Citation**: authors or issuing body, title, journal or body, year, and an
  identifier (PMID, DOI or URL). Each one must point at a page or document opened in
  this session.
- **Evidence level**, one of: guideline recommendation (with its class and level of
  evidence or GRADE grade when the guideline states one), systematic review or
  meta-analysis, RCT, observational study, case series, expert opinion or narrative
  review.
- **Year** of publication or of the guideline edition, so stale evidence is visible.
  When a newer edition of a guideline exists, cite the newer one.

Apply these tests before keeping a claim:

1. Does the opened source state this claim, in this population, at this dose or in
   this setting? Paraphrase the source, do not extrapolate from it.
2. Does the source belong to the allowed set? If not, discard the claim.
3. Is the number or direction of effect quoted exactly as the source gives it
   (effect size, confidence interval, absolute versus relative risk)?

## Workflow

1. Restate the question in one line and extract: the population (age, condition,
   setting), the intervention or exposure, the comparison, the outcome, and whether
   the user is describing their own situation or an emergency.
2. Confirm web access. Run one web search or fetch against `pubmed.ncbi.nlm.nih.gov`.
   If it fails for lack of a web tool, stop and report that the skill cannot run.
3. Classify the question:
   - **Simple**: one fact or one recommendation with a clear guideline answer and no
     likely conflict (for example a dosing threshold, a compression rate, a
     vaccination interval, a reference range).
   - **Complex**: several sub-questions, a treatment comparison, a risk-benefit
     judgment, likely conflicting evidence, a recent development, or any question
     where the population or setting changes the answer.
4. For a **simple** question, research it yourself:
   - Search lane B first (the guideline body that owns the topic), then lane A for a
     systematic review or meta-analysis, then lane C for a recent trial or review.
     Use `site:` restricted queries, for example `site:pubmed.ncbi.nlm.nih.gov
     <terms> systematic review`.
   - Open at least two sources from different lanes and read the passage that
     answers the question. Record each citation, evidence level and year.
   - Re-open each cited source once more and confirm the exact sentence or table
     supports the claim as you phrased it. Drop anything that does not survive.
   - Write the answer in the Output format below.
5. For a **complex** question, spawn the source-lane subagents in ONE message,
   blocking, one per lane A, B, C and D (add a fifth for a specialty society when the
   topic has an obvious owner outside lane B, for example ADA for diabetes or IDSA
   for infectious disease).
   Give each the brief in "Source-lane subagent brief" with its lane filled in.
6. Collect all lane results. Do not read them as the answer yet.
7. Spawn at least one **verifier** subagent, blocking, with the brief in "Verifier
   subagent brief" and all lane findings pasted in verbatim. For more than about
   twenty claims, split the claims across two verifiers.
8. Build the answer from the verifier's confirmed claims only. Claims the verifier
   could not verify are dropped from Key findings and, when material, listed under
   "What is uncertain / not found". Do not re-add a dropped claim from your own
   knowledge.
9. Write the answer in the Output format below, with the Method line stating whether
   lanes ran as parallel subagents or sequentially, and whether UpToDate was
   accessible.

Without a subagent tool, perform steps 5-7 yourself: run lane A, then B, then C,
then D, recording findings in the lane output shape; then do the verification pass
as a distinct step, re-opening every cited source before writing.

## Source-lane subagent brief

Send each lane agent this text with the placeholders filled in:

```
Research the following scientific question using ONLY the sources named for your
lane. You have web search and fetch tools. Return nothing you did not open and read.

Question: <restated question>
Population / intervention / comparison / outcome: <from step 1>
Your lane: <A | B | C | D> — <lane description and domains from the Allowed sources table>

Rules:
- Search only your lane's domains (use site: restricted queries). Open each
  candidate and read the relevant section before using it.
- Prefer the newest guideline edition, then systematic reviews and meta-analyses,
  then RCTs, then observational work.
- For each claim return: the claim in one sentence, quoted as the source states it;
  population and setting; effect size with confidence interval when given; evidence
  level (guideline recommendation with class/level or GRADE, meta-analysis, RCT,
  observational, expert opinion); year; full citation (authors or body, title,
  journal or body, year, PMID or DOI or URL).
- Lane D only: if UpToDate does not open or shows a paywall, return the single line
  "UpToDate inaccessible" and nothing else.
- Do not fill gaps from memory. If your lane has nothing on a sub-question, say
  "nothing found in this lane for: <sub-question>".

Return format: a numbered list of claims as described, then a "Searched" list of
the queries you ran and the URLs you opened.
```

## Verifier subagent brief

Send the verifier this text with the lane findings pasted in:

```
You are verifying research findings before they are used in an answer. You have web
search and fetch tools. Do not add new claims.

Question: <restated question>

Findings from the source lanes (verbatim):
<paste every lane's output>

For every claim:
1. Open the cited source (PMID, DOI or URL). If it does not open, mark the claim
   "could not verify: source inaccessible".
2. Find the passage, table or recommendation the claim rests on. Confirm it says
   what the claim says, for the same population, dose and setting, with the same
   numbers. Mark "confirmed" or "could not verify: <what differs>".
3. Confirm the source is in the allowed set: PubMed-indexed peer-reviewed journal,
   ERC/ESC/AHA/CDC or another official health body or specialty society, NEJM, The
   Lancet, JAMA, BMJ, or UpToDate. Otherwise mark "could not verify: source not
   allowed".

Then return three sections:
- Confirmed matches: claims supported by two or more independent sources, with
  the citation numbers.
- Contradictions: claims where sources disagree. For each, state which source says
  what and the likely reason (population, publication date, study design, dose,
  outcome definition).
- Could not verify: each claim with the reason.
```

## Output format

Open with the emergency line when step 1 found emergency symptoms being described
(chest pain, stroke signs, anaphylaxis, severe bleeding, suicidal intent and the
like): one sentence telling the user to contact emergency services first.

Then:

1. **Bottom line** — two to four sentences answering the question directly, with
   citation numbers.
2. **Key findings** — one bullet per claim: the claim, inline citation number(s)
   `[n]`, evidence level, year. Group by sub-question when there are several. Mark
   any source outside the core list.
3. **Agreement and contradictions** — the verifier's confirmed matches and
   contradictions, each contradiction with who says what and the likely reason.
4. **What is uncertain / not found** — sub-questions with no trustworthy evidence
   found, claims the verifier could not confirm (stated as unconfirmed, not as
   facts), and known limits of the evidence (small trials, old guidelines,
   population mismatch).
5. **Method** — one line: parallel subagents or sequential lanes; UpToDate read or
   inaccessible; number of sources opened.
6. **References** — numbered list matching the inline numbers: authors or body,
   title, journal or body, year, PMID or DOI or URL.

For a question about the user's own health, add exactly one plain sentence after the
Bottom line: this is a summary of published evidence, not individual medical advice,
and personal decisions belong with a clinician. Keep it to that sentence.

Keep the whole answer under 1200 words unless the user asks for more.

## When to use

- Any health, medical, nutrition, drug, supplement, symptom, disease, treatment,
  diagnosis or exercise-physiology question, whether general or about the user's own
  situation.
- Any other empirical scientific question where the user wants to know what the
  evidence shows (physiology, pharmacology, epidemiology, public health, sports
  science, toxicology, and similar).
- Any request phrased as "is it safe", "does it work", "what do the studies say",
  "what do the guidelines recommend", "side effects of", "how much".

## Do NOT use

- To research a company or person. Use `research-entity`.
- For a general, market, news or non-scientific topic. Use `deep-research`.
- To summarise one PDF or video the user has already given you. Use `analyze-pdf`
  or `analyze-youtube`.
- To answer from your own knowledge when web access is missing. Say the skill cannot
  run instead.

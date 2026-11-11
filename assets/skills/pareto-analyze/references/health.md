# Pareto analysis: health

Read this before step 3 of the workflow when the outcome is about the user's body or habits: weight, energy, sleep, fitness, a symptom. Units here are usually **levers** (sleep, diet items, exercise, a treatment), and their numbers are **estimated** unless the user has their own log.

## The evidence rule

- Every effect size that does not come from the user's own log goes through the `scientific-research` skill. Invoke it with one question per lever ("how much does <lever> change <outcome>, in <unit>, in <population>?") and use the figures and sources it returns. Never fill a value from memory.
- Label each row `estimated: <source>` or `measured: <the user's log and its period>`.
- A measured row outranks an estimated one about the same lever.
- This skill ranks levers. It does not diagnose, and it does not replace a clinician: when the outcome is a symptom, a medication or a condition, say so in the report and keep the proposed move to "raise this with your clinician first" where the lever is a treatment.

## Typical metrics

| Outcome | Direction | Unit | Value column |
|---|---|---|---|
| Excess energy intake | less | food or drink item outside the plan | kcal over the period |
| Body weight change | less or more | lever (diet item, activity, sleep) | estimated kcal per week, all levers on that one scale |
| Poor sleep | less | lever (caffeine timing, screens, alcohol, schedule) | estimated minutes of sleep lost or gained |
| Low activity | more | activity | minutes or energy spent per week |
| A recurring symptom | less | trigger | occurrences that followed the trigger, from a diary |

## Where the data comes from

- **The user's own log** (measured): a food diary or tracking app export, a sleep or activity tracker export, a symptom diary. Ask for at least one full week, including the weekend.
- **Research** (estimated): effect sizes returned by `scientific-research`, converted to the outcome's scale. If the levers cannot be put on one scale, do not compute shares: list them in order of effect with their sources.
- When the user has no log and the question is about their own intake or habits, recommend keeping one for a week before ranking. A ranking of estimates for an average person is a weaker answer than a week of the user's own numbers.

## Typical shared traits

Check each for every logged item, from the log or by asking the user:

- Time of day (after dinner, late evening).
- Setting (at the desk, in front of a screen, when eating out).
- Category (sweets, sugary drinks, alcohol, fried food).
- Planned or unplanned.
- What came before it (a short night, a skipped meal, a stressful day).

## Pitfalls

- **Entangled levers.** Many health levers work through each other (sleep, appetite and exercise are the usual example). When a lever only works through another, the fit check in step 2 applies. Rank only what can be separated, and when `scientific-research` shows one lever sitting upstream of the others, name it as the one to act on first.
- **Raw totals instead of excess.** The largest item in a food log is usually a planned meal. Rank what lies outside the plan, or the amount above the target.
- **Under-reported logs.** Snacks and drinks are the entries people forget. Report it as the weakest assumption when a log shows less than the weight trend implies.
- **One week is one week.** A holiday, an illness or a celebration distorts it. Name the period.
- **Population averages.** An estimated effect is an average over a study population and may not apply to this user. Say so, and prefer a measurement.
- **Spreading the advice.** When one item carries most of the excess, name it first and alone. A list of five small changes hides the one that pays.

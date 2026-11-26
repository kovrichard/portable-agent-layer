# Pareto analysis: sales

Read this before step 3 of the workflow when the outcome is revenue, profit, pipeline or churn. Numbers are **measured**: they come from the user's CRM, invoicing or billing system.

## Typical metrics

| Outcome | Direction | Unit | Value column |
|---|---|---|---|
| Revenue | more | client | invoiced amount over a period |
| Profit | more | client or product | revenue minus direct cost |
| New business | more | acquisition channel, or deal | value of deals won |
| Churn | less | lost client, or churn reason | recurring revenue lost |
| Support or delivery cost | less | client | hours or cost spent |
| Late payment | less | client | overdue amount x days |

## Where the data comes from

- **Revenue and profit**: an export from the invoicing or accounting system, one row per invoice, with the client as the unit. Use paid or invoiced amounts, not quotes.
- **New business**: the CRM's closed-won deals with their source field.
- **Churn**: the billing system's cancellations with the recurring amount each one carried, plus the cancellation reason when it was recorded.
- **Cost to serve**: time tracking or the support system, summed per client.

Ask for a full year when the business is seasonal; state the period in the report. Write one row per invoice or deal and let the tool sum rows that name the same client.

## Typical shared traits

Check each for every client from a field in the export, or ask the user for the ones that are not recorded:

- Acquisition channel (referral, outbound, ads, events, partner).
- Who referred them, when the channel is referral.
- Size band or industry.
- Product or plan.
- Region or sales owner.
- Age of the relationship (first-year client or long-standing).
- Contract type (recurring or one-off).

## Pitfalls

- **Revenue is not profit.** A top client by revenue can be a bottom client by margin once cost to serve is counted. Say which of the two was ranked, and rank the other when the data exists.
- **One-off deals.** A single large project inflates one period. Check whether the top set is the same over two periods.
- **Blank source fields.** Channel fields are often empty for older clients. Report the unknown share; when it is large, the trait is not established yet, and filling the field is the next measurement.
- **Concentration is also a risk.** The clients that carry the outcome are the ones whose loss would hurt most. Name that in the weakest assumption or the move instead of only proposing to do more of the same.
- **Survivorship in churn.** Ranking churn reasons only among clients who gave a reason ignores the silent ones. Report how many cancellations had no reason.
- **Small tails still cost.** Do not propose dropping the tail from a revenue ranking alone: that needs the cost-to-serve ranking too.

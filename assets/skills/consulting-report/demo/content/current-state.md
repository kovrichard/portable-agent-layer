## Production Deploy Pipeline

The current pipeline is a linear GitHub Actions workflow: PR → staging → canary → production. There are health checks at each stage, and SLO-based gates block on red. What's missing is a rollback step: once traffic is shifted to a new version, reverting requires a manual re-deploy of the previous image, which in 4 out of the last 12 incidents required direct database work because schema migrations had already run.

| Stage | Automated | Gate | Rollback |
|-------|-----------|------|----------|
| PR checks | Yes | Unit + integration tests | N/A |
| Staging deploy | Yes | Smoke tests | One-click |
| Canary (10%) | Yes | SLO compare 15m | Automatic |
| Production | Yes | Manual approve | **Manual, untested** |

> The "Manual, untested" cell is the single largest finding in this report.

## On-Call Practice

The team runs a weekly rotation. In practice, three engineers cover most of the load:

- Engineer A — 28% of minutes
- Engineer B — 24%
- Engineer C — 19%
- Remaining 8 engineers split the other 29%

The organization's own runbook requires a shadow-rotation before any solo shift. In the last two quarters, zero new engineers completed it.

## Runbook Inventory

Of 14 tier-1 services:

- **Fresh** (reviewed within 6 months): 5
- **Aging** (6–18 months): 2
- **Stale** (18+ months): 7

Three of the stale services have been re-architected since their last runbook update.

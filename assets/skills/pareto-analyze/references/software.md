# Pareto analysis: software

Read this before step 3 of the workflow when the outcome is about code, builds, tests or a running service. Numbers here are almost always **measured**: the tools already record them.

## Typical metrics

| Outcome | Direction | Unit | Value column |
|---|---|---|---|
| Test suite time | less | test file (or test case) | seconds per file |
| CI cost or duration | less | job or step | billed minutes, or seconds, summed over a period |
| Flaky failures | less | test, or failure signature | failed runs over a period |
| Latency | less | endpoint or query | total time = calls x mean duration |
| Errors | less | error signature | occurrences over a period |
| Bundle or image size | less | module, dependency or layer | bytes |

## Where the data comes from

- **Test time**: the test runner's per-file or per-test timing report (a JUnit XML or JSON reporter). When the runner reports only a total, run each file on its own and record the wall time.
- **CI**: the CI provider's API or usage export, one row per job run. Sum over at least a week so that one unusual run does not decide the ranking.
- **Flaky failures**: CI history of runs that failed and then passed on retry with no code change, one row per failure.
- **Latency**: tracing or access logs. Rank by total time (calls x duration), not by the slowest single call: a fast endpoint called a million times can outweigh a slow one called twice.
- **Errors**: the error tracker's grouped issues, or logs reduced to a signature (message with ids and numbers removed), one row per occurrence.
- **Size**: the bundler's or image builder's size report.

Write one row per observation and let the tool sum rows that name the same unit.

## Typical shared traits

Check each for every unit with one search or one field, never from the file name:

- Starts a subprocess, a container, a browser or a database.
- Touches the network or the real file system instead of a fake.
- Uses a shared fixture or a particular setup step.
- Sleeps or waits on a fixed timer.
- Belongs to one dependency, one owner team or one service.
- Runs on a particular runner type, operating system or region.
- Was introduced by one change or one release (for errors and flakiness).

## Pitfalls

- **One run is noisy.** Timings vary between runs. Measure twice, or sum several runs, before trusting a ranking where the top units are close together.
- **Parallel runs hide wall time.** Summed per-file seconds are CPU-side cost; the wall time of a parallel suite is set by its slowest worker. State which of the two the outcome is.
- **Cold caches.** A first run after a dependency change measures the cache, not the tests.
- **Counting instead of weighing.** Ten occurrences of a harmless warning are not worth more than one outage. When units differ in severity, weight the value or analyze severities separately.
- **Fixing units instead of the cause.** When the top set shares a trait, tuning its members one by one leaves the cause in place for the next file. Propose the structural move.
- **Name-based traits.** A file called `integration` may start nothing, and one called `unit` may start a server. Run the check.

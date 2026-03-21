---
name: review
description: Security-focused code review with severity ratings
---

When the user invokes /review <file, diff, or PR>:

1. Read the target code or diff in full
2. Analyze for:
   - **Security** — OWASP top 10, injection, auth, data exposure
   - **Logic** — edge cases, off-by-one, null handling, race conditions
   - **Performance** — N+1 queries, unnecessary allocations, blocking calls
   - **Style** — consistency with surrounding code (not your preferences)
3. Output findings grouped by severity:
   - CRITICAL — must fix before merge
   - WARNING — should fix, creates risk
   - SUGGESTION — nice to have
4. Each finding includes: file:line, what's wrong, concrete fix
5. End with a one-line verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION

# minimum

PAL skill for a minimum-duration run: the agent keeps working on one task for at least the time you set, improving the weakest part on every pass. The opposite of `timebox`, which is a ceiling.

Say "work on this for at least 30 minutes", "keep improving this for an hour" or "cook it". The agent asks its questions once, writes a goal and a bar (2-5 dimensions, each with a target and a check), then loops: pass, check against the bar, fix the weakest part, log the round. Before the floor, PAL's Stop hook refuses to end the turn and sends the agent back with a rotating lens (recheck, critic, skeptic, alternative, simplify, verify, end-user).

See `SKILL.md` for the full workflow. The commands behind it:

```bash
pal cli minimum start --for 30m --goal "<what good looks like>" --bar "<dimension: target, how checked>"
pal cli minimum round --scores "<dimension: n/10, ...>" --weakest "<weakest part>" --did "<what changed>"
pal cli minimum status
pal cli minimum end      # your way out: ends the run, also before the floor (the agent's own call is refused until then)
```

Limits: no questions reach you during the run, and a safety cap releases the agent after 20 push-backs even if the floor is not reached; the summary says so when that happens.

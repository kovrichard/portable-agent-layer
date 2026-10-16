# Opinion Tracking

PAL steers every session with two kinds of always-on rules, both stored in `memory/adaptation/rules.json` and injected through `memory/relationship/opinions-context.md`:

- **Opinions** come from corrections. PAL labels each correction in the background, drafts a rule once its kind recurs, and the user decides with `pal cli rule list | approve | opinion | deny`. `pal cli rule add-opinion` writes one by hand.
- **Reinforcements** come from praise. Each praise that names a behavior drafts one at once; the `reinforce` skill asks the user in session whether to keep it. They appear under **Keep doing**, with their own cap. `pal cli rule add-reinforcement` writes one by hand.

Nothing steers until the user approves it. `pal cli rule retire <id>` ends either kind.

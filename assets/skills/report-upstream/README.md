# report-upstream

PAL skill for reporting a bug in PAL itself to the upstream PAL repository. The agent writes the report, PAL strips and checks it for anything personal, you read it in full, and it is sent only when you say yes.

Say "report this upstream", "file a PAL bug" or "open an issue for PAL". The agent confirms the defect is in PAL (not in your project, the agent or another tool), writes a summary, steps to reproduce on a fresh `PAL_HOME`, evidence, the cause and a fix suggestion, then checks whether an upstream issue already describes it. You get the report exactly as it would be sent and one question: new issue, add to an existing one, or don't send.

What is in a report: the text the agent wrote about the PAL defect and an environment table (PAL version and channel, OS, architecture, agent, Bun version, language, which context toggles are off), and a closing line saying `pal cli report` drafted it and that a workflow in the PAL repository may label it `user-report`. What is never in it: your files, prompts or transcripts, and your project's name, path or remote. A leak check blocks sending while it finds your home path, user name, host name, real name, an email address, a project or folder name, a git remote, a person or company from your knowledge store, or anything shaped like a token.

See `SKILL.md` for the full workflow. The commands behind it:

```bash
pal cli report draft --title "<title>" --body-file <path>   # anonymise, add the environment table, run the leak check
pal cli report show <id>                                    # the report exactly as it would be sent
pal cli report similar <id>                                 # upstream issues that may already describe it
pal cli report send <id> --approved [--comment <number>]    # file it, or add it to an existing issue
pal cli report decline <id>                                 # record that you chose not to send
pal cli report list
```

Limits: a sent report is public and cannot be withdrawn by PAL. The leak check matches known names and shapes; it cannot judge whether a sentence describes your work too closely, so read the report before you answer. Without `gh`, PAL prints a prefilled link or a file to paste and you file it yourself.

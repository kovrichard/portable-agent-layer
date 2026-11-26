# pal-review

A Claude Code mod that opens a review pane for PAL. Type `/pal-review` and the pane lists:

- **Rule drafts** PAL wrote from your corrections, each with **Approve** and **Deny**.
- **Open ISCs** of the PAL project that owns the session's folder, each with **Done**.

Every button runs a `pal cli` command (`rule approve`, `rule deny`, `project complete-isc`), so PAL records each decision itself. The pane reads PAL again after every action and after every turn while it is open. On the Claude desktop app a minimized pane shows a one-line count as a widget.

## Needs

- PAL installed, with `pal` on the PATH of the process that runs Claude Code. Without it the pane says `Could not read PAL`.
- A Claude Code build with function-hook mods (early access; the API can change between releases).

## Install

```
/plugin marketplace add kovrichard/portable-agent-layer
/plugin install pal-review@pal
```

While developing, load it from a checkout instead: `claude --plugin-dir assets/plugins/pal-review`.

## Limits

- Shows the first 5 drafts and the first 8 ISCs, with a count of the rest.
- Buttons act at once. Undo with `pal cli rule retire <id>` or `pal cli project reopen-isc <project> <id>`.

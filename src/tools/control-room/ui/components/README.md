# ui/components

shadcn/ui components, vendored and re-themed for Industry.

Two adaptations were made to every file, and both apply to anything added later:

- **No RSC.** The `"use client"` directive is dropped — nothing here renders on a
  server. It matches `components.json`'s `"rsc": false`.
- **Industry, not the shadcn default palette.** The upstream components are
  rounded, filled and shadowed and speak in semantic tokens (`bg-primary`,
  `text-muted-foreground`, `border-input`). Industry is square, hairline and
  unfilled, and its tokens are the ones in `../theme.css` (`accent-*`,
  `neutral-*`, `divider`, `ink`, `bg`). Class strings are rewritten accordingly;
  no parallel semantic token layer exists, so there is one vocabulary to learn.

`bunx shadcn@latest add <name>` will fetch a component, but its output needs both
passes above before it belongs here. Copying the shape from
`~/Development/git/catalyst/src/components/ui` is usually faster.

# Consulting Report — Working Directory

## Structure

- `content/report-data.ts` — report structure (cover metadata, sections, optional findings / recommendations / conclusion / appendix)
- `content/*.md` — narrative sections; reference them from `report-data.ts` by filename
- `diagrams/` — drop PNG/JPG images; they're compressed to JPEG 70% / max 1200px at render time
- `diagrams-compressed/` — generated; do not edit

## Render

```
bun ~/.pal/skills/consulting-report/tools/generate-pdf.ts .
```

Output goes into this directory as `<client>-<title>-<date>.{pdf,html}` unless you pass `--pdf <path>` or `--html <path>`.

## Defaults

Without a `brand` block in `report-data.ts`, reports are stamped with **Konvert7** branding. Override per engagement by adding:

```ts
brand: {
  businessName: "Your Brand",
  logoPath: "/absolute/path/to/logo.png",   // optional — text-only cover if omitted
  brandLabel: "Strategic Assessment",        // optional sub-label on cover
}
```

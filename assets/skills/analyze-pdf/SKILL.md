---
name: analyze-pdf
description: "Download and analyze PDF files from URLs or local paths — extract text, answer questions, summarize content. Use when analyzing, reading, or extracting information from a PDF."
argument-hint: <URL or file path>
---

When the user asks to analyze, read, or extract information from a PDF:

## How to get the PDF

- **URL**: Use the `pdf-download` CLI tool to download and archive the PDF:
  ```bash
  bun ~/.pal/skills/analyze-pdf/tools/pdf-download.ts -- <url> [--filename <name.pdf>]
  ```
  The tool downloads the file, saves it to `memory/downloads/{YYYY}/{MM}/{DD}/{filename}.pdf`, and returns JSON with the saved `path`.

- **Local path**: Use the file directly.

## How to read it

Use your native PDF reading capability (e.g. a Read tool or equivalent). Most modern multimodal models can parse PDF content directly — no external dependencies, libraries, or conversion tools are needed.

Do NOT install PDF processing tools (poppler, pdftotext, etc.) unless the user explicitly asks. Native reading is sufficient.

### Fallback: when native Read fails

If the Read tool fails to open the PDF (e.g. error mentioning `pdftoppm`, missing renderer, or unsupported format), fall back to the text-extraction CLI:

```bash
bun ~/.pal/skills/analyze-pdf/tools/pdf-read.ts -- <path>
```

Use the stdout output as the document content and proceed with the user's request as normal.

If `pdf-read.ts` also fails, stop completely — report the exact errors from both attempts and ask the user how to proceed. Never infer PDF content from filename, metadata, or assumptions.

## What to do with it

Follow the user's request. Common tasks:

- **Answer a specific question** about the PDF content
- **Summarize** the document (defer to /summarize if installed)
- **Extract structured data** (tables, references, entities)
- **Extract wisdom** (defer to /extract-wisdom if installed)
- **Compare** with other documents or information

## Guidelines

- For large PDFs, read specific page ranges rather than the entire document
- Preserve the original structure (headings, lists, tables) when relevant
- Quote verbatim when the user asks about specific content
- If the PDF contains images or diagrams, describe them

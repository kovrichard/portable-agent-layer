---
name: analyze-pdf
description: Download and analyze PDF files from URLs or local paths — extract text, answer questions, summarize content
---

When the user asks to analyze, read, or extract information from a PDF:

## How to get the PDF

- **URL**: Use the `tool:pdf-download` CLI tool to download and archive the PDF:
  ```bash
  bun run tool:pdf-download -- <url> [--filename <name.pdf>]
  ```
  The tool downloads the file, saves it to `memory/downloads/{YYYY}/{MM}/{DD}/{filename}.pdf`, and returns JSON with the saved `path`.

- **Local path**: Use the file directly.

## How to read it

Use your native PDF reading capability (e.g. a Read tool or equivalent). Most modern multimodal models can parse PDF content directly — no external dependencies, libraries, or conversion tools are needed.

Do NOT install PDF processing tools (poppler, pdftotext, etc.) unless the user explicitly asks. Native reading is sufficient.

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

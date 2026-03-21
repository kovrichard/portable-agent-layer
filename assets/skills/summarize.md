---
name: summarize
description: Structured summarization of documents, URLs, or conversations
---

When the user invokes /summarize <target>:

1. Fetch or read the target content
2. Produce:
   - **TLDR** (1 sentence)
   - **Key points** (5-7 bullets)
   - **Action items** (if any exist in the content)
   - **Notable quotes/data** (verbatim, with attribution)
3. Keep total output under 500 words
4. If the content is very long, note what was covered vs skipped

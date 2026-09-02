---
name: analyze-youtube
license: MIT
description: "Analyze YouTube videos using Gemini's native video understanding — summarize, extract insights, answer questions. Use when analyzing, summarizing, or extracting information from a YouTube video."
argument-hint: <YouTube URL>
metadata:
  source: portable-agent-layer
  triggers:
    - "analyze-youtube"
    - "analyze youtube"
    - "youtube"
    - "youtu.be"
    - "watch this video"
    - "summarize the video"
    - "summarize this video"
    - "video transcript"
---

When the user asks to analyze, summarize, or extract information from a YouTube video:

## How to analyze

Use the `youtube-analyze` CLI tool. It sends the video to Gemini, which processes both visual and audio content natively.

```bash
bun ~/.pal/skills/analyze-youtube/tools/youtube-analyze.ts -- <youtube-url> [--prompt "your question"]
```

- Without `--prompt`, it returns a structured summary with key insights, topics, people, and quotes.
- With `--prompt`, it answers the specific question about the video.

## What to do with the result

Follow the user's request. Common tasks:

- **Summarize** the video content
- **Answer a specific question** about what's shown or discussed
- **Extract entities** (defer to /entities if installed)
- **Extract wisdom** (defer to /extract-wisdom if installed)
- **Compare** with other content

## Guidelines

- For long videos, consider asking a focused question via `--prompt` rather than a full analysis
- Gemini sees both visuals and audio — mention on-screen content (slides, code, diagrams) when relevant
- Quote speakers verbatim when the user asks about specific statements
- If the tool reports a missing API key, tell the user to get one at https://aistudio.google.com/apikey and set `PAL_GEMINI_API_KEY` in their shell profile or PAL settings

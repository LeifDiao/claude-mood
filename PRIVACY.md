# Privacy

Claude Mood runs entirely on your machine. It reads the Claude Code transcripts already on
your disk and draws a local dashboard. It makes no outbound network calls of its own.

## Data Read

- `~/.claude/projects/**/*.jsonl` — the session transcripts Claude Code already writes. The
  server parses them to derive each session's title, project, git branch, last-active time,
  error counts, context usage, and state.
- `~/.claude/mood-ctx/*.json` (optional) — sidecar files written by *your own* statusline
  script, if you opt into the real context-window enhancement. Read only to show 🟢 measured
  context usage.

## Network & External Services

- **The server makes no network calls.** It never contacts Anthropic or any model, and
  spends zero tokens. All parsing and state derivation happen locally.
- **The front end talks only to its own origin** (`localhost`). No CDNs, external fonts, or
  images are loaded.
- Claude Mood uploads **no telemetry or analytics**.

## Data Written

- The server itself writes **nothing** to your transcripts — it is read-only.
- The optional `~/.claude/mood-ctx/*.json` sidecars are written by *your* statusline script
  (not by this server), and only if you choose to set that up.

## Report Contents

The dashboard surfaces information drawn from your own sessions (project names, git branches,
session titles, and short state signals). It is served only to `localhost` and stays on your
machine. Treat the page as private, the same as the transcripts it reads from.

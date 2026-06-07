# Changelog

All notable changes to Claude Mood are documented here.
This project follows [Semantic Versioning](https://semver.org/).

---

## [0.1.0] — 2026-06-07

First release.

### Added
- Live, zero-token, fully-local dashboard for all your running Claude Code sessions, derived
  purely from the transcripts Claude Code writes to `~/.claude/projects`.
- Ten first-match-wins session states (waiting on you, needs approval, running a crew,
  just started, dozing, running hot, stuck, nearly full, wrapping up, cruising), each with
  its own face.
- Per-card details: project + git branch, last-active time, model (with `[1M]` tag), and
  real/estimated context usage (🟢/⚪).
- Optional statusline sidecar (`~/.claude/mood-ctx`) for measuring the real context window.
- Config via env vars (`PORT`, `DOZE_MIN`, `ACTIVE_WINDOW_MIN`, `CONTEXT_WINDOW`, `MOOD_LANG`).
- Bilingual (中文 / English) dashboard and landing page; `start.command` one-click launcher.

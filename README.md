# Claude Mood

> **A live, zero-token, fully-local command center for every Claude Code session you've got
> running — how many, what each is doing, and the mood it's in.**

🌏 [中文版](./README_zh.md) · 🖥 [Live page](https://leifdiao.github.io/claude-mood/) · ⚖️ [License](./LICENSE)

> **中文简介：** 一眼看清你同时开着几个 Claude Code，以及每一个此刻是什么**状态/心情**。纯本地、零 token、零依赖 —— 只读 Claude Code 自己写在硬盘上的对话记录，画成一张面板。完整中文文档 → [README_zh.md](./README_zh.md)

---

**▶ Run:** `node server.js` (or double-click `start.command`) → open **http://localhost:4242**
Zero dependencies, zero tokens, fully local.

> 💡 Want the full tour? It's the same page that ships as the project's [live page](https://leifdiao.github.io/claude-mood/) — a bilingual one-pager.

## What it does

Power users never run just one Claude Code. One window refactors the backend, one writes
tests, one reads docs, and one… you've forgotten what it's even doing. **Claude Mood** is a
playful command center: it shows how many sessions are live, what each is called, which
project it's in, how long since it last worked, and what state it's in right now — purely by
reading the transcript files Claude Code already writes to disk. No instrumentation, no magic.

In short: it reads the diary Claude Code already keeps on your disk, and draws a panel.

## Zero token · pure local

This is the project's iron rule — and why it's free and private.

- 📂 **Reads local files only** — the server only reads `~/.claude/projects/**/*.jsonl`, the
  transcripts Claude Code already writes.
- 🚫 **Never calls a model / API** — no requests to Anthropic or any model. Not a single token.
- 🔒 **Data stays local** — no outbound network calls, ever.
- 🏠 **Localhost only** — the front end only talks to its own origin. No CDNs, external fonts,
  or images.

## Quick start

Requires Node ≥ 18.

```bash
node server.js
# or double-click start.command on Mac
```

Then open 👉 **http://localhost:4242**

> Port taken? The server auto-increments (up to +20) and prints the port it landed on.

## The 10 states

Ten states, first-match-wins. The first five are situational (more actionable); the last
five are moods. Each has its own face.

| | State | Trigger |
| :--: | :-- | :-- |
| 🙋 | **Waiting on you** | Turn ended, awaiting your reply (last line is AI text, no pending tool) |
| 🔐 | **Needs approval** | A tool stalled >60s with nothing after it — likely awaiting your "allow" |
| 🐝 | **Running a crew ×N** | N subagents are running (`subagents/` has recent activity) |
| 🆕 | **Just started** | Brand-new session (<3min), warming up |
| 😴 | **Dozing** | Quiet for more than `DOZE_MIN` (12min) and not waiting on you |
| 🥵 | **Running hot** | Tools failing in a row (≥2 of the last 10, or ≥3 consecutively) |
| 🤔 | **Stuck** | The **last** message self-reports being stuck ("restart / stuck / too deep") |
| 🫗 | **Nearly full** | **Real** context usage ≥85% (measured windows only) |
| 🎉 | **Wrapping up** | The **last** message says "done / finished / 搞定" |
| 😎 | **Cruising** | Working smoothly; none of the above |

> States are fun-over-precise — this is a dashboard, not a profiler. 🔐 is a weak heuristic
> ("a tool is stalled" and "really awaiting approval" look the same at the file level; after
> 20min it falls back to 😴).

Each card also shows: **project + git branch, last-active time, model (with a `[1M]` tag),
and real/estimated context usage (🟢/⚪)**.

## Config

All via env vars, with sane defaults.

| Var | Default | Description |
| :-- | :--: | :-- |
| `PORT` | `4242` | Listen port; auto-increments if busy (up to +20) |
| `DOZE_MIN` | `12` | Minutes of silence before 😴 Dozing |
| `ACTIVE_WINDOW_MIN` | `15` | How long before an inactive session drops off the panel (returns on its next heartbeat) |
| `CONTEXT_WINDOW` | `1000000` | Fallback window for the CTX % **estimate** (used when the real window can't be read) |
| `MOOD_LANG` | auto | Terminal log language: `zh` / `en` (defaults to your system locale) |

```bash
PORT=5000 DOZE_MIN=20 node server.js
```

## Optional: real context window

The transcript doesn't expose each session's **real** context window (the model name is
stripped of its `[1m]` tag). But Claude Code's **statusline** does — its input carries
`.context_window.context_window_size` and `.used_percentage`. So there's an **optional**
enhancement: have your statusline write the real window to a sidecar file that the dashboard
prefers. With it, active cards show 🟢 (measured); without it, they fall back to the estimate
(⚪). Still zero-token and local.

Add this after `input=$(cat)` in your `~/.claude/statusline.sh`:

```bash
# [Claude Mood] write the real context window to a sidecar file for the dashboard
MOOD_DIR="$HOME/.claude/mood-ctx"
MOOD_SID=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
if [ -n "$MOOD_SID" ]; then
  mkdir -p "$MOOD_DIR" 2>/dev/null
  printf '%s' "$input" | jq -c '{window: .context_window.context_window_size, pct: .context_window.used_percentage, tokens: .context_window.total_input_tokens, model: .model.id, ts: now}' > "$MOOD_DIR/$MOOD_SID.json" 2>/dev/null
fi
```

> No statusline yet? Create `~/.claude/statusline.sh` (start with `#!/bin/bash` + `input=$(cat)`,
> then `chmod +x`) and set `"statusLine": {"type":"command","command":"~/.claude/statusline.sh"}`
> in `~/.claude/settings.json`.

## Non-goals

| Rule | |
| :-- | :-- |
| **Zero token** | Never calls a model / API |
| **Pure local** | Reads local files, binds localhost |
| **Fun over precise** | States are playful, not exact |
| **Main sessions only** | Subagents don't count toward the session total |
| **Claude Code only (v1)** | Other tools' transcripts not yet supported |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

CC BY-NC 4.0 — free for personal, educational, and any non-commercial use; commercial use
requires a separate license. See [LICENSE](./LICENSE).

---

*Made for Claude Code power users. 100% local, 0 tokens, all vibes. 🚢*

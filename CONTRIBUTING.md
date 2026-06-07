# Contributing

Contributions are welcome.

## Development checks

Run these before opening a pull request:

```bash
# Syntax-check the server
node --check server.js

# Validate package.json parses
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"
```

## Testing locally

```bash
node server.js
# then open http://localhost:4242
```

Test it against real input: have one or more Claude Code sessions running (ideally in
different states — waiting on you, dozing, running subagents) and confirm each card shows
the right project, branch, last-active time, and state. To exercise the optional real
context-window path, wire up the statusline sidecar described in the README and check that
active cards switch from ⚪ (estimate) to 🟢 (measured).

## Design principles

- **Zero token, pure local** — never call a model or any API; only read the transcripts
  Claude Code already writes, and only bind localhost. This is the project's iron rule.
- **Deterministic core** — every state, title, and number is derived from on-disk bytes;
  no guessing that can't be reproduced from the same transcript.
- **Fun over precise** — it's a dashboard, not a profiler. Prefer a readable, playful signal
  over a fragile "accurate" one.
- Avoid external dependencies unless they remove meaningful complexity (today: zero deps).
- Keep secrets / API keys out of the repo.
- Update the README and CHANGELOG when behavior changes.

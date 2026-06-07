# Security

Claude Mood is a local Node server that reads the Claude Code transcripts already on your
disk and serves a dashboard to `localhost`. It makes **no outbound network calls** and never
contacts a model or API.

## Reporting Issues

If you find a security issue, please open a private report through GitHub security
advisories when available, or contact the maintainer through the GitHub profile linked in
this repository. Please do not file public issues for security-sensitive reports.

## Security-sensitive areas

- **Bind address.** The server is meant to listen on loopback only. Anything that would
  expose it on a non-local interface (so another machine on the network could read your
  session data) is a security issue.
- **Local path handling.** The server reads `~/.claude/projects/**/*.jsonl` and the optional
  `~/.claude/mood-ctx/*.json` sidecars. It should read only inside those intended
  directories — guard against path traversal via crafted file or session names.
- **HTML injection from transcript content.** Session titles, project names, and message
  snippets originate from your transcripts (which can include content from untrusted sources
  you pasted in). A bug that lets that content reach the dashboard DOM unescaped is a
  security issue.
- **Read-only by design.** The server reads transcripts; it does not write to them. The only
  files written are the optional sidecars, and those are written by *your own* statusline
  script, not by this server.

## What Claude Mood does to limit exposure

It never makes network calls, never calls a model, binds to localhost, reads only the
intended local directories, and treats transcript-derived text as untrusted when rendering.

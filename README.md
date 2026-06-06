# Claude Crew · 你的小 Claude 们都在忙啥

> 一眼看清你同时开着几个 Claude Code，以及每一个此刻是什么**状态/心情**。
> *A live, zero-token, all-local command center for every Claude Code session you've got running — how many, what each is doing, and the mood it's in.*

**▶ 运行 / Run:** `node server.js`（或双击 `start.command` / or double-click `start.command`）→ 打开 / open **http://localhost:4242**
零依赖、零 token、纯本地。 *Zero dependencies, zero tokens, fully local.*

> 💡 想看完整功能介绍？直接在浏览器打开 **`landing.html`**（中英双语宣传页）。
> *Want the full tour? Open **`landing.html`** in a browser — a bilingual one-pager.*

![screenshot](./screenshot.png)

---

## 这是什么 · What it is

**中文**
重度玩家从来不止开一个 Claude Code：一个窗口在重构后端，一个在写测试，一个在啃文档，还有一个……你已经忘了它在干嘛了。**Claude Crew** 是一个好玩的「指挥中心」——告诉你现在有几个会话在跑、每个叫什么、在哪个项目里、上次干活多久前，以及它此刻是什么状态。而这一切纯粹靠**读取 Claude Code 自己写在本地的对话记录**实现，没有插桩、没有魔法。

**English**
Power users never run just one Claude Code. One window refactors the backend, one writes tests, one reads docs, and one… you've forgotten what it's even doing. **Claude Crew** is a playful command center: it shows how many sessions are live, what each is called, which project it's in, how long since it last worked, and what state it's in right now — purely by reading the transcript files Claude Code already writes to disk. No instrumentation, no magic.

---

## 零 token · 纯本地 · Zero token, pure local

这是项目的**铁律**，也是它为什么完全免费、完全私密。 *This is the project's iron rule — and why it's free and private.*

- 📂 **只读本地文件 / Reads local files only** — 服务端只读取 `~/.claude/projects/**/*.jsonl`，这些是 Claude Code 本来就在落盘的对话记录。 *Only reads the transcripts Claude Code already writes.*
- 🚫 **从不调用模型 / API · Never calls a model/API** — 不连 Anthropic、不发任何请求，不花一分钱 token。 *No requests to Anthropic or any model. Not a single token.*
- 🔒 **数据不出本机 / Data stays local** — 没有任何出站网络请求。 *No outbound network calls ever.*
- 🏠 **只绑 localhost / Localhost only** — 前端只向自己的源拿数据，无 CDN、无外部字体/图片。 *No CDNs, external fonts, or images.*

> 一句话：它只是在你电脑里翻了翻 Claude Code 自己写的日记，然后画了张面板。
> *In short: it reads the diary Claude Code already keeps on your disk, and draws a panel.*

---

## 快速开始 · Quick start

需要 Node ≥ 18。 *Requires Node ≥ 18.*

```bash
node server.js
# 或 Mac 上双击 start.command / or double-click start.command on Mac
```

然后打开 / then open 👉 **http://localhost:4242**

> 端口被占用了？服务会自动往后找（最多 +20）并在终端打印最终端口。
> *Port taken? The server auto-increments (up to +20) and prints the port it landed on.*

---

## 状态表 · The 10 states

10 种状态，单一优先级、命中即停。前 5 个是**情境**（更可操作），后 5 个是**心情**。每个状态有专属表情。
*Ten states, first-match-wins. The first five are situational (more actionable); the last five are moods. Each has its own face.*

| | 状态 · State | 触发 · Trigger |
| :--: | :-- | :-- |
| 🙋 | **在等你** · Waiting on you | 这轮说完了在等你回话（末行是 AI 文本、无待跑工具）<br>*Turn ended, awaiting your reply* |
| 🔐 | **等你批权限** · Needs approval | 卡在一个工具调用上 >60s 没下文，多半在等你点「允许」<br>*A tool stalled >60s — likely awaiting your OK* |
| 🐝 | **在带队 ×N** · Running a crew | 派了 N 个 subagent 在跑（`subagents/` 近期有活动）<br>*Orchestrating N subagents* |
| 🆕 | **刚开工** · Just started | 会话刚创建（<3min），热身中<br>*Brand-new session (<3min), warming up* |
| 😴 | **在发呆** · Dozing | 安静超过 `DOZE_MIN`（12min）且不是在等你<br>*Quiet for >DOZE_MIN and not waiting on you* |
| 🥵 | **有点红温** · Running hot | 最近连着报错（10 次里 ≥2，或连续 ≥3）<br>*Tools failing in a row* |
| 🤔 | **陷进去了** · Stuck | **最后一条**消息含「重开 / 卡住 / 陷太深」<br>*Last message self-reports being stuck* |
| 🫗 | **快满了** · Nearly full | **真实**上下文 ≥85%（仅 🟢 实测窗口）<br>*Real context usage ≥85% (measured windows only)* |
| 🎉 | **收尾了** · Wrapping up | **最后一条**消息含「完成 / 搞定 / done」<br>*Last message says "done"* |
| 😎 | **状态在线** · Cruising | 平稳干活，以上都不中<br>*Working smoothly; none of the above* |

> 状态判定是**好玩 > 准确**——它是个面板，不是性能分析器。🔐 是**弱判定**（"工具卡着"和"真在等批权限"文件层面长得像，>20min 会落回 😴）。
> *States are fun-over-precise — this is a dashboard, not a profiler. 🔐 is a weak heuristic.*

此外每张卡还显示：**项目 + git 分支、上次活跃、模型（含 `[1M]` 标）、真实/估算的上下文占比（🟢/⚪）**。
*Each card also shows: project + git branch, last-active time, model (with a `[1M]` tag), and real/estimated context usage.*

---

## 配置 · Config

全部通过环境变量，均有合理默认值。 *All via env vars, with sane defaults.*

| 变量 · Var | 默认 · Default | 说明 · Description |
| :-- | :--: | :-- |
| `PORT` | `4242` | 监听端口，被占用自动 +1（最多 +20）· Listen port; auto-increments if busy |
| `DOZE_MIN` | `12` | 静默多少分钟判为「在发呆 😴」· Minutes of silence before 😴 |
| `ACTIVE_WINDOW_MIN` | `15` | 多久没「活着」就从面板移走（关掉/发呆久的会消退，下次心跳再回来）· How long before an inactive session drops off |
| `CONTEXT_WINDOW` | `1000000` | CTX 百分比的**估算**窗口（真实窗口读不到时的回落，默认 1M）· Fallback window for the CTX % estimate |

```bash
PORT=5000 DOZE_MIN=20 node server.js
```

---

## 可选增强：真实上下文窗口 · Optional: real context window

**中文**
transcript 里读不到每个会话**真实的**上下文窗口（模型名被抹掉了 `[1m]` 标记）。但 Claude Code 的 **statusline** 拿得到——它的输入里有 `.context_window.context_window_size` 和 `.used_percentage`（真值）。所以本项目提供一个**可选**增强：让 statusline 顺手把真实窗口写进一个边车文件，面板优先读它。装了之后,活跃会话 CTX 旁是 🟢（实测）；没装则回落估算（⚪）。仍然零 token、纯本地。

**English**
The transcript doesn't expose each session's **real** context window (the model name is stripped of its `[1m]` tag). But Claude Code's **statusline** does — its input carries `.context_window.context_window_size` and `.used_percentage`. So there's an **optional** enhancement: have your statusline write the real window to a sidecar file that the dashboard prefers. With it, active cards show 🟢 (measured); without it, they fall back to the estimate (⚪). Still zero-token and local.

在你的 `~/.claude/statusline.sh` 里（`input=$(cat)` 之后）加这段 / Add this after `input=$(cat)` in your `~/.claude/statusline.sh`:

```bash
# [Claude Crew] write the real context window to a sidecar file for the dashboard
CREW_DIR="$HOME/.claude/crew-ctx"
CREW_SID=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
if [ -n "$CREW_SID" ]; then
  mkdir -p "$CREW_DIR" 2>/dev/null
  printf '%s' "$input" | jq -c '{window: .context_window.context_window_size, pct: .context_window.used_percentage, tokens: .context_window.total_input_tokens, model: .model.id, ts: now}' > "$CREW_DIR/$CREW_SID.json" 2>/dev/null
fi
```

> 没有 statusline？新建 `~/.claude/statusline.sh`（开头 `#!/bin/bash` + `input=$(cat)`、`chmod +x`），并在 `~/.claude/settings.json` 设 `"statusLine": {"type":"command","command":"~/.claude/statusline.sh"}`。
> *No statusline yet? Create the file (`#!/bin/bash` + `input=$(cat)`, then `chmod +x`) and set `statusLine` in `~/.claude/settings.json`.*

---

## 非目标 · Non-goals

| 铁律 · Rule | |
| :-- | :-- |
| **零 token** · Zero token | 永远不调用模型/API · Never calls a model/API |
| **纯本地** · Pure local | 只读本机、只绑 localhost · Reads local files, binds localhost |
| **好玩 > 准确** · Fun over precise | 状态图一乐，不保证科学 · States are playful, not exact |
| **只看主会话** · Main sessions only | subagent 不计入主会话数 · Subagents don't count toward the session total |
| **v1 只支持 Claude Code** · Claude Code only (v1) | 暂不支持其他工具的记录 · Other tools' transcripts not yet supported |

---

## 关于名字 · About the name

> **「Claude Crew」只是个临时占位名**，随时可改——它没被硬编码进任何对外契约。
> ***"Claude Crew" is a working name** — easy to change; it isn't hardcoded into any contract.*

---

*Made for Claude Code power users. 100% local, 0 tokens, all vibes. 🚢*

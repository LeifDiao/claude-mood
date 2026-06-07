# Claude Mood

> **一眼看清你同时开着几个 Claude Code，以及每一个此刻是什么状态/心情的本地指挥中心 —— 零 token、纯本地、零依赖。**

🌏 [English](./README.md) · 🖥 [在线页面](https://leifdiao.github.io/claude-mood/) · ⚖️ [许可](./LICENSE)

---

**▶ 运行：** `node server.js`（或双击 `start.command`）→ 打开 **http://localhost:4242**
零依赖、零 token、纯本地。

> 💡 想看完整功能介绍？就是项目的[在线页面](https://leifdiao.github.io/claude-mood/) —— 一张中英双语宣传页。

## 这是什么

重度玩家从来不止开一个 Claude Code：一个窗口在重构后端，一个在写测试，一个在啃文档，还有一个……你已经忘了它在干嘛了。**Claude Mood** 是一个好玩的「指挥中心」—— 告诉你现在有几个会话在跑、每个叫什么、在哪个项目里、上次干活多久前，以及它此刻是什么状态。而这一切纯粹靠**读取 Claude Code 自己写在本地的对话记录**实现，没有插桩、没有魔法。

一句话：它只是在你电脑里翻了翻 Claude Code 自己写的日记，然后画了张面板。

## 零 token · 纯本地

这是项目的**铁律**，也是它为什么完全免费、完全私密。

- 📂 **只读本地文件** —— 服务端只读取 `~/.claude/projects/**/*.jsonl`，这些是 Claude Code 本来就在落盘的对话记录。
- 🚫 **从不调用模型 / API** —— 不连 Anthropic、不发任何请求，不花一分钱 token。
- 🔒 **数据不出本机** —— 没有任何出站网络请求。
- 🏠 **只绑 localhost** —— 前端只向自己的源拿数据，无 CDN、无外部字体/图片。

## 快速开始

需要 Node ≥ 18。

```bash
node server.js
# 或 Mac 上双击 start.command
```

然后打开 👉 **http://localhost:4242**

> 端口被占用了？服务会自动往后找（最多 +20）并在终端打印最终端口。

## 状态表 · 10 种状态

10 种状态，单一优先级、命中即停。前 5 个是**情境**（更可操作），后 5 个是**心情**。每个状态有专属表情。

| | 状态 | 触发 |
| :--: | :-- | :-- |
| 🙋 | **在等你** | 这轮说完了在等你回话（末行是 AI 文本、无待跑工具） |
| 🔐 | **等你批权限** | 卡在一个工具调用上 >60s 没下文，多半在等你点「允许」 |
| 🐝 | **在带队 ×N** | 派了 N 个 subagent 在跑（`subagents/` 近期有活动） |
| 🆕 | **刚开工** | 会话刚创建（<3min），热身中 |
| 😴 | **在发呆** | 安静超过 `DOZE_MIN`（12min）且不是在等你 |
| 🥵 | **有点红温** | 最近连着报错（10 次里 ≥2，或连续 ≥3） |
| 🤔 | **陷进去了** | **最后一条**消息含「重开 / 卡住 / 陷太深」 |
| 🫗 | **快满了** | **真实**上下文 ≥85%（仅实测窗口） |
| 🎉 | **收尾了** | **最后一条**消息含「完成 / 搞定 / done」 |
| 😎 | **状态在线** | 平稳干活，以上都不中 |

> 状态判定是**好玩 > 准确** —— 它是个面板，不是性能分析器。🔐 是**弱判定**（「工具卡着」和「真在等批权限」文件层面长得像，>20min 会落回 😴）。

此外每张卡还显示：**项目 + git 分支、上次活跃、模型（含 `[1M]` 标）、真实/估算的上下文占比（🟢/⚪）**。

## 配置

全部通过环境变量，均有合理默认值。

| 变量 | 默认 | 说明 |
| :-- | :--: | :-- |
| `PORT` | `4242` | 监听端口，被占用自动 +1（最多 +20） |
| `DOZE_MIN` | `12` | 静默多少分钟判为「在发呆 😴」 |
| `ACTIVE_WINDOW_MIN` | `15` | 多久没活动就从面板移走（下次心跳再回来） |
| `CONTEXT_WINDOW` | `1000000` | CTX 百分比的**估算**窗口（读不到真实窗口时的回落） |
| `MOOD_LANG` | 自动 | 终端日志语言：`zh` / `en`（默认跟随系统 locale） |

```bash
PORT=5000 DOZE_MIN=20 node server.js
```

## 可选增强：真实上下文窗口

transcript 里读不到每个会话**真实的**上下文窗口（模型名被抹掉了 `[1m]` 标记）。但 Claude Code 的 **statusline** 拿得到 —— 它的输入里有 `.context_window.context_window_size` 和 `.used_percentage`（真值）。所以本项目提供一个**可选**增强：让 statusline 顺手把真实窗口写进一个边车文件，面板优先读它。装了之后，活跃会话 CTX 旁是 🟢（实测）；没装则回落估算（⚪）。仍然零 token、纯本地。

在你的 `~/.claude/statusline.sh` 里（`input=$(cat)` 之后）加这段：

```bash
# [Claude Mood] write the real context window to a sidecar file for the dashboard
MOOD_DIR="$HOME/.claude/mood-ctx"
MOOD_SID=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
if [ -n "$MOOD_SID" ]; then
  mkdir -p "$MOOD_DIR" 2>/dev/null
  printf '%s' "$input" | jq -c '{window: .context_window.context_window_size, pct: .context_window.used_percentage, tokens: .context_window.total_input_tokens, model: .model.id, ts: now}' > "$MOOD_DIR/$MOOD_SID.json" 2>/dev/null
fi
```

> 没有 statusline？新建 `~/.claude/statusline.sh`（开头 `#!/bin/bash` + `input=$(cat)`、`chmod +x`），并在 `~/.claude/settings.json` 设 `"statusLine": {"type":"command","command":"~/.claude/statusline.sh"}`。

## 非目标

| 铁律 | |
| :-- | :-- |
| **零 token** | 永远不调用模型 / API |
| **纯本地** | 只读本机、只绑 localhost |
| **好玩 > 准确** | 状态图一乐，不保证科学 |
| **只看主会话** | subagent 不计入主会话数 |
| **v1 只支持 Claude Code** | 暂不支持其他工具的记录 |

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可

CC BY-NC 4.0 —— 个人 / 教育 / 研究及任何非商业用途免费;商业用途需单独授权。见 [LICENSE](./LICENSE)。

---

*为 Claude Code 重度用户而做。100% 本地，0 token，全凭氛围。🚢*

/*
 * Claude Mood — 零 token、纯本地。
 * 这个服务器只做三件事：读取 ~/.claude/projects 下已经写好的会话 jsonl 文件、
 * 在内存里把它们解析成会话状态、再通过 127.0.0.1 上的 HTTP 把状态喂给本地仪表盘。
 * 全程没有任何 LLM 调用、没有任何模型推理、没有任何对外网络请求——心情(mood)、标题、
 * 报错统计、上下文占用全部由已落盘的 transcript 字节确定性推导而来。它只读不写，只
 * 监听 localhost，因此既不花一个 token，也不泄露任何数据到机器之外。
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');

// 终端日志语言：按系统 locale 自动选中/英。可用 MOOD_LANG=zh|en 强制覆盖。
// 命中 zh（如 zh_CN.UTF-8 / zh-Hans）走中文，其余一律英文。
const LOG_ZH = (() => {
  const force = (process.env.MOOD_LANG || '').toLowerCase();
  if (force === 'zh') return true;
  if (force === 'en') return false;
  const loc = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '').toLowerCase();
  return loc.indexOf('zh') === 0; // 如 zh_CN.UTF-8 / zh-Hans
})();

// ---------------------------------------------------------------------------
// CONFIG — 所有阈值集中在这里，全部可由环境变量覆盖，改参数无需改代码。
// ---------------------------------------------------------------------------
const CONFIG = (() => {
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  const dozeMin = num(process.env.DOZE_MIN, 12);
  // 多久没"活着"（jsonl 写入 或 statusline 心跳）就从面板移走。默认 15min：
  // 关掉/发呆超 15min 的窗口先停掉，等下次心跳再回来；开着活跃的靠心跳续命留住。
  const activeWindowMin = num(process.env.ACTIVE_WINDOW_MIN, 15);
  // 真实窗口在 transcript 里读不到（model 字段不带 [1m] 标记，窗口数字也没落盘）。
  // 故按配置估算；默认 1M——对"始终开 1M"的用户是准确的，且数据可佐证：
  // 多个会话 token 远超 20 万仍在活跃 => 窗口必 >200k，否则早该 auto-compact。
  const contextWindow = num(process.env.CONTEXT_WINDOW, 1000000);
  return {
    PORT: num(process.env.PORT, 4242),
    activeWindowMs: activeWindowMin * 60 * 1000, // 默认 15min
    activeNowMs: 90 * 1000, // 90s 内真动过手才算"活跃中"（< dozeMs，避免和"发呆"打架）
    subagentActiveMs: 2 * 60 * 1000, // subagent 文件 2min 内有改动 = 在跑
    justStartedMs: 3 * 60 * 1000, // 会话创建 3min 内 = 刚开工
    permissionStallMs: 60 * 1000, // 末行卡在 tool_use 超 60s = 可能在等你批权限
    permissionMaxMs: 20 * 60 * 1000, // 超 20min 就当弃用了（落到发呆），别一直标"等批权限"
    FULL_PCT: 85, // 真实上下文 >=85% = 快满了（仅对实测窗口生效）
    dozeMs: dozeMin * 60 * 1000, // 默认 12min 没动静 => 发呆
    contextWindow, // 估算窗口（无边车真实值时的回落），默认 1000000
    cap: 40,
    // statusline 边车：真实窗口大小由 statusline 脚本写入 ~/.claude/mood-ctx/<sid>.json
    sidecarUseMs: 24 * 60 * 60 * 1000, // 24h 内的边车才采用（覆盖所有展示中的会话）
    sidecarGcMs: 7 * 24 * 60 * 60 * 1000, // 超过 7 天的边车文件顺手清理
    // mood 算法常量
    RECENT_LINES: 80,
    RECENT_AGE_MS: 10 * 60 * 1000, // 10min
    HOT_ERR_IN_LAST10: 2,
    HOT_CONSEC_ERR: 3,
    EXCITED_SUCC_STREAK: 5,
    // 读文件相关
    TAIL_BYTES: 256 * 1024, // 256 KB 尾读
  };
})();

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');
const MOOD_CTX_DIR = path.join(os.homedir(), '.claude', 'mood-ctx');
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

// ---------------------------------------------------------------------------
// MOOD 固定查表（emoji / 中文标签），纯查找，不在算法里计算。
// ---------------------------------------------------------------------------
// 9 个状态：情境类（waiting/fleet/fresh/doze）+ 心情类（hot/stuck/full/excited/online）。
// emoji 与状态语言无关，留在后端；人类可读的中/英文标签由前端 i18n 表负责。
const MOOD_EMOJI = {
  waiting: '🙋', permission: '🔐', fleet: '🐝', fresh: '🆕', doze: '😴',
  hot: '🥵', stuck: '🤔', full: '🫗', excited: '🎉', online: '😎',
};
// 状态全集（顺序 = 前端 tally 顺序）
const STATES = ['waiting', 'permission', 'fleet', 'fresh', 'doze', 'hot', 'stuck', 'full', 'excited', 'online'];
const ZERO_BY_MOOD = () => STATES.reduce((o, k) => ((o[k] = 0), o), {});

// 自我叙述标记 —— 大小写不敏感的子串匹配。
const STUCK_MARKERS = [
  '重开', '重新开始', '陷得太深', '陷进去', '绕不出', '卡住了', '退一步', '想不出',
  'start over', "i'm stuck", 'im stuck', 'going in circles', 'step back',
  'let me reconsider', 'i suggest restarting', 'stuck in a loop',
];
const WRAP_MARKERS = [
  '完成', '搞定', '大功告成', '都通过', '全部完成',
  'all set', 'done', 'all tests pass', 'complete',
];

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

// 注：相对时间（"3 分钟前" / "3m ago"）与时长短语过去由后端拼好下发；现在改为后端只发
// 原始毫秒（lastActiveAgeMs / reason.ms），由前端 i18n 按所选语言格式化，故此处不再需要。

// 大小写不敏感：haystack 是否命中 markers 任意一个子串。
function anyMarker(haystack, markers) {
  if (!haystack) return false;
  const low = haystack.toLowerCase();
  for (const m of markers) {
    if (low.indexOf(m.toLowerCase()) !== -1) return true;
  }
  return false;
}

// 截断字符串到 n 字符，截断时追加 "…"。
function truncate(s, n) {
  if (typeof s !== 'string') return s;
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

// 把 jsonl 的一段文本切成已解析的逻辑行数组；JSON.parse 失败的行静默跳过。
function parseLines(text) {
  const out = [];
  const raw = text.split('\n');
  for (const line of raw) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch (_) {
      // 跳过坏行（尾读可能切断行）
    }
  }
  return out;
}

// 尾读：只读文件最后 TAIL_BYTES 字节；若 offset>0，丢弃第一条（可能被切断的）半行。
// 对小文件（size <= TAIL_BYTES）等价于整文件读取。
function readTail(absPath, size) {
  const tail = CONFIG.TAIL_BYTES;
  const offset = Math.max(0, size - tail);
  const len = size - offset;
  if (len <= 0) return '';
  const fd = fs.openSync(absPath, 'r');
  try {
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, offset);
    let text = buf.toString('utf8');
    if (offset > 0) {
      const nl = text.indexOf('\n');
      text = nl === -1 ? '' : text.slice(nl + 1);
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

// 头读：只读文件最前 TAIL_BYTES 字节（用于在长文件尾部找不到 ai-title 时补一刀）。
function readHead(absPath, size) {
  const len = Math.min(size, CONFIG.TAIL_BYTES);
  if (len <= 0) return '';
  const fd = fs.openSync(absPath, 'r');
  try {
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, 0);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// 把目录名（路径里的 "/" 被换成 "-"）尽力反解成一个绝对路径。解码本身有损，只在没有
// cwd 行时兜底使用：把开头的 "-" 还原成 "/"，其余 "-" 还原成 "/"（best-effort）。
function bestEffortDecodeDir(dirName) {
  if (!dirName) return null;
  // 形如 "-Users-leifdiao-Desktop-foo" => "/Users/leifdiao/Desktop/foo"
  let s = dirName.replace(/-/g, '/');
  if (!s.startsWith('/')) s = '/' + s;
  return s;
}

// ---------------------------------------------------------------------------
// MOOD 算法 —— FIRST MATCH WINS。在"最近窗口"上工作，返回 {mood, reason}。
// ---------------------------------------------------------------------------
function computeMood(parsedLines, mtimeMs) {
  const C = CONFIG;
  // recentLines = 最后 RECENT_LINES 条；对带 timestamp 的行额外要求其 ts 在 (mtime - RECENT_AGE_MS) 之内。
  const tail = parsedLines.slice(-C.RECENT_LINES);
  const recentLines = tail.filter((ln) => {
    if (ln && typeof ln.timestamp === 'string') {
      const t = Date.parse(ln.timestamp);
      if (Number.isFinite(t)) return t >= mtimeMs - C.RECENT_AGE_MS;
    }
    return true; // 没有 timestamp 的行（ai-title/last-prompt/mode…）按位置保留
  });

  // assistantTexts：每条 assistant 行（数组内容）拼接其 text + thinking。
  const assistantTexts = [];
  // toolResultFlags：按顺序，每条 user 行（数组内容）里每个 tool_result 推一个 (is_error?1:0)。
  const toolResultFlags = [];

  for (const ln of recentLines) {
    if (!ln || typeof ln !== 'object') continue;
    if (ln.type === 'assistant' && ln.message && Array.isArray(ln.message.content)) {
      let s = '';
      for (const item of ln.message.content) {
        if (!item || typeof item !== 'object') continue;
        if (item.type === 'text' && typeof item.text === 'string') s += item.text + '\n';
        else if (item.type === 'thinking' && typeof item.thinking === 'string') s += item.thinking + '\n';
      }
      if (s) assistantTexts.push(s);
    } else if (ln.type === 'user' && ln.message && Array.isArray(ln.message.content)) {
      for (const item of ln.message.content) {
        if (item && typeof item === 'object' && item.type === 'tool_result') {
          toolResultFlags.push(item.is_error === true ? 1 : 0);
        }
      }
    }
  }

  const last10 = toolResultFlags.slice(-10);
  const errInLast10 = last10.reduce((a, b) => a + b, 0);
  // 最长连续 1 的游程
  let maxConsecErr = 0;
  let run = 0;
  for (const f of toolResultFlags) {
    if (f === 1) {
      run += 1;
      if (run > maxConsecErr) maxConsecErr = run;
    } else {
      run = 0;
    }
  }
  // lastAssistantText = 最后一条 assistant 文本；收紧 stuck/excited 只看它，
  // 免得"讨论到关键词"也误判（比如这条会话本身在聊 stuck 规则）。
  const lastAssistantText = assistantTexts.length ? assistantTexts[assistantTexts.length - 1] : '';

  // DECISION（只决"干活心情"：hot/stuck/excited/online；首个命中即返回）。
  // waiting/fleet/fresh/doze/full 在 buildState 里按更高优先级覆盖。
  // reason 一律返回「结构化原因」{ key, ... 数值参数 }，人类可读文案由前端按所选语言渲染。
  // 1) 报错风暴 -> hot
  if (errInLast10 >= C.HOT_ERR_IN_LAST10 || maxConsecErr >= C.HOT_CONSEC_ERR) {
    return { mood: 'hot', reason: { key: 'errors', n: Math.max(errInLast10, maxConsecErr) } };
  }
  // 2) 自述卡住 -> stuck（只看最后一条消息）
  if (anyMarker(lastAssistantText, STUCK_MARKERS)) {
    return { mood: 'stuck', reason: { key: 'stuck' } };
  }
  // 3) 收尾词（只看最后一条消息）-> excited（不再把"单纯连续成功"当兴奋）
  if (anyMarker(lastAssistantText, WRAP_MARKERS)) {
    return { mood: 'excited', reason: { key: 'finished' } };
  }
  // 4) 默认 -> online（平稳干活，包括一路成功）
  return { mood: 'online', reason: { key: 'steady' } };
}

// ---------------------------------------------------------------------------
// 单文件解析 —— 从尾读窗口里抽取契约所需的全部字段。
// 返回一个 summary 对象（会被缓存）。
// ---------------------------------------------------------------------------
function parseSessionFile(absPath, dirName, stat) {
  const size = stat.size;
  const mtimeMs = stat.mtimeMs;

  let parsed = [];
  try {
    const tailText = readTail(absPath, size);
    parsed = parseLines(tailText);
  } catch (_) {
    parsed = [];
  }

  // 从尾窗口里收集各字段（取"最后一个/最后一个非空"）。
  let cwd = null;
  let gitBranch = null;
  let inFileSessionId = null;
  let model = null;
  let lastUsage = null;
  let aiTitle = null; // 最后一个非空 ai-title
  let lastPrompt = null; // 最后一个非空 last-prompt
  let messageCount = 0;

  for (const ln of parsed) {
    if (!ln || typeof ln !== 'object') continue;
    const type = ln.type;
    if (type === 'assistant' || type === 'user') {
      messageCount += 1;
      if (typeof ln.cwd === 'string' && ln.cwd) cwd = ln.cwd;
      if (Object.prototype.hasOwnProperty.call(ln, 'gitBranch')) {
        // 透传原值（含 "HEAD" 分离头指针）；只有在该行确实带 gitBranch 字段时更新。
        if (ln.gitBranch !== undefined) gitBranch = ln.gitBranch;
      }
      if (typeof ln.sessionId === 'string' && ln.sessionId) inFileSessionId = ln.sessionId;
      if (type === 'assistant' && ln.message && typeof ln.message === 'object') {
        if (typeof ln.message.model === 'string' && ln.message.model) model = ln.message.model;
        if (ln.message.usage && typeof ln.message.usage === 'object') lastUsage = ln.message.usage;
      }
    } else if (type === 'ai-title') {
      if (typeof ln.aiTitle === 'string' && ln.aiTitle.trim()) aiTitle = ln.aiTitle;
    } else if (type === 'last-prompt') {
      if (typeof ln.lastPrompt === 'string' && ln.lastPrompt.trim()) lastPrompt = ln.lastPrompt;
    }
    // 其余类型（system/bridge-session/queue-operation/attachment/mode/permission-mode/
    // file-history-snapshot 以及任何未知类型）静默忽略。
  }

  // ai-title / last-prompt 在长文件里可能不在尾窗口 —— 补一刀头读。
  if ((aiTitle === null || lastPrompt === null) && size > CONFIG.TAIL_BYTES) {
    try {
      const headText = readHead(absPath, size);
      const headLines = parseLines(headText);
      for (const ln of headLines) {
        if (!ln || typeof ln !== 'object') continue;
        if (ln.type === 'ai-title' && typeof ln.aiTitle === 'string' && ln.aiTitle.trim()) {
          aiTitle = ln.aiTitle; // 头里取最后一个非空命中
        } else if (
          ln.type === 'last-prompt' &&
          typeof ln.lastPrompt === 'string' &&
          ln.lastPrompt.trim()
        ) {
          // 只在尾里没拿到时才用头里的值兜底
          if (lastPrompt === null) lastPrompt = ln.lastPrompt;
        }
      }
    } catch (_) {
      // 头读失败无所谓，走兜底
    }
  }

  // 上下文 token：取最后一个带 usage 的 assistant 行。
  let contextTokens = 0;
  if (lastUsage) {
    const it = Number(lastUsage.input_tokens) || 0;
    const cr = Number(lastUsage.cache_read_input_tokens) || 0;
    const cc = Number(lastUsage.cache_creation_input_tokens) || 0;
    contextTokens = it + cr + cc;
  }

  // 上下文占比：真实窗口读不到，用配置的估算窗口（默认 1M）算个百分比。
  // 注：上下文窗口/占比在 buildState 里算（要用边车的真实窗口 + 实时 token），
  // 不缓存进 summary，这样边车更新能立刻反映。

  // cwd 兜底：尾窗口没有 cwd 行时，尽力反解目录名。
  if (!cwd) cwd = bestEffortDecodeDir(dirName) || 'unknown';

  // project：path.basename(cwd) ；再兜底解码目录名 basename ；再兜底 "unknown"。
  let project = null;
  if (cwd && cwd !== 'unknown') project = path.basename(cwd);
  if (!project) {
    const decoded = bestEffortDecodeDir(dirName);
    if (decoded) project = path.basename(decoded);
  }
  if (!project) project = 'unknown';

  // title：最后非空 ai-title -> last-prompt(截 60) -> project basename -> "(无标题)"。
  let title;
  if (aiTitle) title = aiTitle;
  else if (lastPrompt) title = truncate(lastPrompt, 60);
  else if (project && project !== 'unknown') title = project;
  else title = '(无标题)';

  // 干活心情（hot/stuck/excited/online）。
  const mood = computeMood(parsed, mtimeMs);

  // awaitingUser：最后一条有意义的行是 assistant 纯文本（无待执行 tool_use）= 这轮说完了、在等你。
  // 末行是 tool_result(user) 或 assistant 带 tool_use = 还在干活。
  let awaitingUser = false; // 末行 assistant 纯文本 = 等你回话
  let awaitingTool = false; // 末行 assistant 带 tool_use = 在等工具/可能等你批权限
  for (let i = parsed.length - 1; i >= 0; i--) {
    const ln = parsed[i];
    if (!ln || (ln.type !== 'assistant' && ln.type !== 'user')) continue;
    if (ln.type === 'assistant') {
      const c = ln.message && ln.message.content;
      const hasToolUse = Array.isArray(c) && c.some((b) => b && b.type === 'tool_use');
      awaitingUser = !hasToolUse;
      awaitingTool = hasToolUse;
    }
    break; // 末行是 user/tool_result -> 两者都 false（还在干活）
  }

  return {
    inFileSessionId,
    project,
    cwd,
    gitBranch: gitBranch === undefined ? null : gitBranch,
    title,
    lastPrompt: lastPrompt ? truncate(lastPrompt, 200) : null,
    model,
    contextTokens,
    messageCount,
    awaitingUser,
    awaitingTool,
    moodMood: mood.mood,
    moodReason: mood.reason,
  };
}

// ---------------------------------------------------------------------------
// MTIME 缓存：path -> { mtimeMs, size, summary }。mtime+size 都没变就复用，免再读文件。
// ---------------------------------------------------------------------------
const fileCache = new Map();

// 枚举所有顶层 main 会话文件，返回 [{ absPath, dirName, fileBase, stat }]。
// 只 readdir 每个 project 目录一层 —— 不递归，因此永远不会进入 <sid>/subagents/。
function enumerateMainFiles() {
  const result = [];
  let projectDirs = [];
  try {
    projectDirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch (_) {
    return result; // ~/.claude/projects 不存在 -> 返回空
  }
  for (const pd of projectDirs) {
    if (!pd.isDirectory()) continue;
    const dirName = pd.name;
    const dirAbs = path.join(PROJECTS_ROOT, dirName);
    let entries = [];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of entries) {
      // 只要顶层 *.jsonl 文件；子目录（含 <sid>/）一律不下探，subagents 天然被排除。
      if (!e.isFile()) continue;
      if (!e.name.endsWith('.jsonl')) continue;
      const absPath = path.join(dirAbs, e.name);
      let stat;
      try {
        stat = fs.statSync(absPath);
      } catch (_) {
        continue;
      }
      result.push({
        absPath,
        dirName,
        fileBase: e.name.slice(0, -'.jsonl'.length),
        stat,
      });
    }
  }
  return result;
}

// 构建 /api/state 的完整响应对象。
// 读 statusline 边车文件：sid -> { window }（真实上下文窗口大小）。
// 没装 statusline 增强时目录不存在 -> 返回空 Map，一切回落到估算窗口。
function loadSidecarWindows(now) {
  const map = new Map();
  let entries;
  try {
    entries = fs.readdirSync(MOOD_CTX_DIR, { withFileTypes: true });
  } catch (_) {
    return map; // 目录不存在 = 没装增强
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const p = path.join(MOOD_CTX_DIR, e.name);
    let st;
    try { st = fs.statSync(p); } catch (_) { continue; }
    const age = now - st.mtimeMs;
    if (age > CONFIG.sidecarGcMs) { try { fs.unlinkSync(p); } catch (_) {} continue; } // 太老 -> 清理
    if (age > CONFIG.sidecarUseMs) continue; // 偏老 -> 留着但不采用
    try {
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      const win = Number(d.window);
      if (Number.isFinite(win) && win > 0) {
        // mtime = statusline 最近一次渲染的时间（= 窗口仍开着的"心跳"）
        map.set(e.name.replace(/\.json$/, ''), { window: win, model: d.model || null, mtime: st.mtimeMs });
      }
    } catch (_) {}
  }
  return map;
}

// 数某个主会话此刻活跃的 subagent 个数：<projectdir>/<sid>/subagents/**.jsonl 里
// mtime 在 subagentActiveMs 内的（含 workflows/wf_*/agent-*.jsonl，排除 journal.jsonl）。
// 没有 subagents 目录就立刻返回 0（绝大多数会话）。
// 返回 { count, latestMtime }：
//  - count      = subagentActiveMs（2min）内有改动的 subagent 数 = 此刻在跑的小弟
//  - latestMtime = 所有 subagent 文件里最新的 mtime（不设窗口），用来给主会话"续命"：
//                 小弟在写文件就等于这个会话还在干活，别被 15min 活跃窗口误清出列表。
function countActiveSubagents(absPath, fileBase, now) {
  const root = path.join(path.dirname(absPath), fileBase, 'subagents');
  let count = 0;
  let latestMtime = 0;
  let scanned = 0;
  const stack = [root];
  while (stack.length && scanned < 500) {
    const dir = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue; // 目录不存在/读不了 -> 跳过
    }
    for (const e of ents) {
      scanned++;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!e.name.endsWith('.jsonl') || e.name === 'journal.jsonl') continue;
      let st;
      try {
        st = fs.statSync(p);
      } catch (_) {
        continue;
      }
      if (st.mtimeMs > latestMtime) latestMtime = st.mtimeMs;
      if (now - st.mtimeMs <= CONFIG.subagentActiveMs) count++;
    }
  }
  return { count, latestMtime };
}

function buildState() {
  const generatedAt = Date.now();
  const files = enumerateMainFiles();
  const sidecar = loadSidecarWindows(generatedAt);
  const seenPaths = new Set();
  const sessions = [];

  for (const f of files) {
    seenPaths.add(f.absPath);
    let summary;
    const cached = fileCache.get(f.absPath);
    if (cached && cached.mtimeMs === f.stat.mtimeMs && cached.size === f.stat.size) {
      summary = cached.summary; // 复用：文件没变
    } else {
      try {
        summary = parseSessionFile(f.absPath, f.dirName, f.stat);
      } catch (_) {
        // 硬错误 -> 跳过该文件，不拖垮整个端点
        continue;
      }
      fileCache.set(f.absPath, {
        mtimeMs: f.stat.mtimeMs,
        size: f.stat.size,
        summary,
      });
    }

    const id = summary.inFileSessionId || f.fileBase; // 文件内 sessionId 始终等于文件名 UUID
    const real = sidecar.get(id);

    // 文件系统信号：活跃 subagent 数 + 最新 subagent 写入时间（workedMs 要用，故先算）。
    const sub = countActiveSubagents(f.absPath, f.fileBase, generatedAt);
    const subagentCount = sub.count;

    // workedMs = 最近一次"真干活"：主会话 jsonl 写入，或小弟（subagent）写文件——
    // 后台带队时主会话会静默，但小弟在跑就等于这个会话在干活（活跃中、不发呆、不被清出）。
    // seenMs = 最近一次"还活着"（再叠加 statusline 心跳，取最新）。关掉窗口后全部停 -> 自然衰减出列表。
    const workedMs = Math.max(f.stat.mtimeMs, sub.latestMtime);
    const seenMs = real ? Math.max(workedMs, real.mtime) : workedMs;
    const ageMs = generatedAt - workedMs;
    // "活跃中"按真干活算（心跳但发呆的不算活跃）；展示/排序按 seenMs（还活着就留住）。
    const isActiveNow = ageMs <= CONFIG.activeNowMs;

    // 上下文窗口：边车有真实值就用真实值（实测），否则回落到估算窗口。
    // token 数始终用 transcript 的实时值，所以占比永远新鲜。
    const contextWindow = real ? real.window : CONFIG.contextWindow;
    const ctxSource = real ? 'real' : 'estimate';
    let contextPct = Math.round((summary.contextTokens / contextWindow) * 100);
    if (contextPct < 0) contextPct = 0;
    if (contextPct > 100) contextPct = 100;

    // 模型名：边车带完整 id（含 [1m] 变体），优先用它；否则用 transcript 的（无变体后缀）。
    const model = real && real.model ? real.model : summary.model;

    // 是否刚开工。
    const justStarted =
      f.stat.birthtimeMs > 0 && generatedAt - f.stat.birthtimeMs <= CONFIG.justStartedMs;

    // ===== 状态决议（情境优先，命中即停）=====
    // 注意：fleet 必须排在 waiting 之前——编排 subagent / workflow 时，主会话这一轮
    // 往往已经说完话（末行是 assistant 纯文本 → awaitingUser=true），但下面一堆小弟
    // 其实正在跑。这种情况是「在带队」而不是「在等你」，否则会误显示 🙋。
    // reason 一律是「结构化原因」{ key, ... 数值参数 }；带时长/计数的，参数也一并发出，
    // 由前端按所选语言（中/英）渲染成人类可读文案。后端只发数据，不发文案。
    let state, reason;
    if (subagentCount > 0) {
      state = 'fleet';
      reason = { key: 'fleet', n: subagentCount };
    } else if (summary.awaitingUser) {
      state = 'waiting';
      reason = ageMs > 40 * 1000 ? { key: 'waiting_dur', ms: Math.round(ageMs) } : { key: 'waiting_just' };
    } else if (
      summary.awaitingTool &&
      ageMs > CONFIG.permissionStallMs &&
      ageMs <= CONFIG.permissionMaxMs
    ) {
      // 末行卡在 tool_use 没下文 = 工具迟迟没返回，多半在等你点"允许"。
      state = 'permission';
      reason = { key: 'permission', ms: Math.round(ageMs) };
    } else if (justStarted) {
      state = 'fresh';
      reason = { key: 'fresh' };
    } else if (ageMs > CONFIG.dozeMs) {
      state = 'doze';
      reason = { key: 'doze', ms: Math.round(ageMs) };
    } else if (
      ctxSource === 'real' &&
      contextPct >= CONFIG.FULL_PCT &&
      (summary.moodMood === 'online' || summary.moodMood === 'excited')
    ) {
      // 真实窗口快满了（红温/卡住优先级更高，所以只在 online/excited 时覆盖）
      state = 'full';
      reason = { key: 'full', pct: contextPct };
    } else {
      state = summary.moodMood; // hot / stuck / excited / online
      reason = summary.moodReason; // 已是结构化对象（见 computeMood）
    }

    sessions.push({
      id,
      project: summary.project,
      cwd: summary.cwd,
      gitBranch: summary.gitBranch === undefined ? null : summary.gitBranch,
      title: summary.title,
      lastPrompt: summary.lastPrompt,
      model,
      mood: state,
      moodEmoji: MOOD_EMOJI[state],
      moodReason: reason, // 结构化原因 { key, n?/ms?/pct? }
      subagentCount, // 前端据此拼「在带队 ×N」/「Leading ×N」
      contextTokens: summary.contextTokens,
      contextWindow,
      contextPct,
      ctxSource,
      messageCount: summary.messageCount,
      lastActiveMs: Math.round(seenMs), // 过滤/排序用"还活着"的时间
      lastActiveAgeMs: Math.round(ageMs), // "上次干活"距今毫秒；前端按语言格式化成相对时间
      isActiveNow,
    });
  }

  // 淘汰已不存在的文件缓存
  for (const key of fileCache.keys()) {
    if (!seenPaths.has(key)) fileCache.delete(key);
  }

  // FILTER：只保留 activeWindow 内的会话。
  let filtered = sessions.filter(
    (s) => generatedAt - s.lastActiveMs <= CONFIG.activeWindowMs
  );

  // SORT：isActiveNow 降序（true 在前），再 lastActiveMs 降序。
  filtered.sort((a, b) => {
    if (a.isActiveNow !== b.isActiveNow) return a.isActiveNow ? -1 : 1;
    return b.lastActiveMs - a.lastActiveMs;
  });

  // CAP：取前 cap 条。
  if (filtered.length > CONFIG.cap) filtered = filtered.slice(0, CONFIG.cap);

  // counts
  const byMood = ZERO_BY_MOOD();
  let activeNow = 0;
  for (const s of filtered) {
    if (byMood[s.mood] !== undefined) byMood[s.mood] += 1;
    if (s.isActiveNow) activeNow += 1;
  }

  return {
    generatedAt,
    config: {
      activeWindowMs: CONFIG.activeWindowMs,
      activeNowMs: CONFIG.activeNowMs,
      dozeMs: CONFIG.dozeMs,
      cap: CONFIG.cap,
    },
    counts: {
      total: filtered.length,
      activeNow,
      byMood,
    },
    sessions: filtered,
  };
}

// ---------------------------------------------------------------------------
// 静态文件服务（仅 /public 下，纯本地资源）。
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendFile(res, absPath) {
  // 防目录穿越：解析后的路径必须仍在 PUBLIC_DIR 之内（index.html 例外，但它本就在 PUBLIC_DIR）。
  const resolved = path.resolve(absPath);
  if (resolved !== INDEX_HTML && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
    return;
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    send(res, 200, { 'Content-Type': mime }, data);
  });
}

// ---------------------------------------------------------------------------
// HTTP 路由
//   GET /            -> public/index.html
//   GET /api/state   -> JSON 契约
//   GET /public/*    -> 静态文件
//   其它              -> 404
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(url.parse(req.url).pathname || '/');
  } catch (_) {
    pathname = url.parse(req.url).pathname || '/';
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
    return;
  }

  // GET / -> 仪表盘
  if (pathname === '/' || pathname === '/index.html') {
    sendFile(res, INDEX_HTML);
    return;
  }

  // GET /api/state -> JSON
  if (pathname === '/api/state') {
    let payload;
    try {
      payload = buildState();
    } catch (e) {
      // 即便出错也返回合法 JSON（空集合），永不让端点抛 500 给前端。
      payload = {
        generatedAt: Date.now(),
        config: {
          activeWindowMs: CONFIG.activeWindowMs,
          activeNowMs: CONFIG.activeNowMs,
          dozeMs: CONFIG.dozeMs,
          cap: CONFIG.cap,
        },
        counts: {
          total: 0,
          activeNow: 0,
          byMood: ZERO_BY_MOOD(),
        },
        sessions: [],
      };
    }
    const body = JSON.stringify(payload);
    send(
      res,
      200,
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body
    );
    return;
  }

  // GET /public/* -> 静态资源
  if (pathname.startsWith('/public/')) {
    const rel = pathname.slice('/public/'.length);
    sendFile(res, path.join(PUBLIC_DIR, rel));
    return;
  }

  // 404
  send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
});

// ---------------------------------------------------------------------------
// 监听：绑定 127.0.0.1（绝不 0.0.0.0）。端口占用则自增至 +20。
// ---------------------------------------------------------------------------
function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      const next = port + 1;
      console.log(LOG_ZH ? `端口 ${port} 被占用，尝试 ${next} …` : `Port ${port} is in use, trying ${next} …`);
      setTimeout(() => listen(next, attemptsLeft - 1), 0);
    } else {
      const msg = err && err.message ? err.message : err;
      console.error(LOG_ZH ? '服务器启动失败：' : 'Failed to start server:', msg);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const urlStr = `http://127.0.0.1:${port}`;
    console.log('');
    console.log(LOG_ZH ? '  🚢  Claude Mood  —  零 token、纯本地' : '  🚢  Claude Mood  —  zero tokens, all local');
    console.log('  ─────────────────────────────────────');
    console.log(LOG_ZH ? `  仪表盘:  ${urlStr}` : `  Dashboard:  ${urlStr}`);
    console.log(LOG_ZH ? `  接口:    ${urlStr}/api/state` : `  API:        ${urlStr}/api/state`);
    console.log(LOG_ZH ? `  数据源:  ${PROJECTS_ROOT}` : `  Source:     ${PROJECTS_ROOT}`);
    console.log(LOG_ZH ? '  只读本地 transcript，绝不发起任何对外请求。' : '  Reads local transcripts only — never makes any outbound request.');
    console.log('');
  });
}

if (require.main === module) {
  listen(CONFIG.PORT, 20);
}

module.exports = { buildState, computeMood, CONFIG, server };

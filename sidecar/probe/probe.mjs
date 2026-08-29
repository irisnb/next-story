// 探底脚本：验证 DSH rc.7 常驻会话所需的 8 项能力（change: resident-ai-session 任务 1.1）
// 独立脚本，不进产品代码。用法：
//   $env:DEEPSEEK_API_KEY = <key>; node probe.mjs <api_base> <model>
// 输出：逐项 JSON 结果 + 总体判定。证据由调用方存档到 docs/。
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const [apiBase, model] = process.argv.slice(2);
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiBase || !model || !apiKey) {
  console.error("usage: node probe.mjs <api_base> <model>  (env DEEPSEEK_API_KEY required)");
  process.exit(2);
}

const results = [];
function record(item, ok, detail) {
  results.push({ item, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${item}: ${detail}`);
}

// ── 1. 隔离 DSH_HOME（必须在 import dsh 模块之前设置）────────────────────────
const home = join(__dirname, ".probe-home");
rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });
process.env.DSH_HOME = home;
process.env.DEEPSEEK_API_KEY = apiKey;

// ── 2. 组装条目：headless profile（dsh-base + dsh-headless）+ 探针 patch ──────
const { loadProfile, composeEntries, boot } = await import("@deepseek-ai/dsh-app-boot");
const { installModelSelection } = await import("@deepseek-ai/dsh-agent");
const { createUserMessage } = await import("@deepseek-ai/dsh-llm");
const { SessionId } = await import("@deepseek-ai/dsh-session");

const installAnchor = join(__dirname, "..", "node_modules", "@deepseek-ai", "dsh", "package.json");
const profile = loadProfile("probe", "headless", installAnchor, home, { userLayer: false });

// !!js 表达式方言（与 dsh-app-boot 的 entryListSchema 一致），保证 round-trip
const JsExpr = new yaml.Type("tag:yaml.org,2002:js", {
  kind: "scalar",
  resolve: (data) => typeof data === "string",
  construct: (data) => ({ __jsExpr: data }),
  represent: (data) => data["__jsExpr"],
});
const entrySchema = yaml.JSON_SCHEMA.extend(JsExpr);

// 默认拒绝：工具/执行/网络/子代理/交互/落盘 全部不装载
const DENY_IDS = [
  "headless-runner", "headless-startup", "hmr",
  // 落盘相关（不落盘要求）
  "session-persistence-jsonl", "session-query-sqlite", "session-telemetry-otel",
  "spill-local", "spill-policy", "session-checkpoint-policy", "attachment-local",
  // 额外 LLM 调用（标题生成）
  "session-title", "session-title-llm",
  // 工具与执行
  "tool-bash", "tool-pwsh", "tool-jobs", "tool-fs", "tool-fs-search",
  "skill", "skill-filesystem", "tool-skill", "tool-todo", "tool-goal", "tool-ralph",
  "tool-str-replace-editor", "tool-web", "web", "web-search-deepseek",
  "subagent", "subagent-spawn-in-process", "subagent-fork-in-process",
  "tool-subagent-control", "tool-subagent-list-agents", "tool-subagent",
  "tool-subagent-fork", "tool-subagent-report", "workflow-worker-thread", "tool-workflow",
  "code-runtime", "subprocess", "bash-sandbox", "pwsh-sandbox",
  "sandbox", "sandbox-policy", "shell-env", "fs-sandbox", "fs-observation-policy",
  // 交互/命令/目标（无常驻宿主语义）
  "user-questions", "approval", "permission", "plan-mode", "commands", "command-feedback",
  "command-goal", "command-compact", "goal", "goal-round-driver", "jobs", "repeat-tool-reminder",
];

const patches = [
  { id: "agent-default-model", config: { provider: "deepseek-official", model } },
  { id: "llm-deepseek", config: { baseURL: apiBase, thinking: "disabled" } },
  // 小保留尾部：让手动压缩有足够的可选区域（产品立项时会按模型容量调参）
  { id: "compaction-basic", config: { retainRatio: 0.05 } },
  ...DENY_IDS.map((id) => ({ id, disabled: true })),
];

const entries = composeEntries([...profile.layers.map((l) => l.patches), patches]);
const configPath = join(__dirname, "cordis.probe.yaml");
writeFileSync(configPath, yaml.dump(entries, { schema: entrySchema, noRefs: true }));

// ── 3. 启动容器（矩阵①）─────────────────────────────────────────────────────
let ctx;
try {
  ctx = await boot("probe", configPath, []);
  record("① 容器可编程启动", true, `boot() 返回已稳定的根上下文，DSH_HOME=${home}`);
} catch (error) {
  record("① 容器可编程启动", false, String(error?.stack ?? error));
  console.log("RESULTS_JSON=" + JSON.stringify(results));
  process.exit(1);
}

// ── 公共驱动工具 ─────────────────────────────────────────────────────────────
const agents = ctx.get("agents");
const defaultModel = ctx.get("agentDefaultModel");
const sessions = ctx.get("sessions");
const selection = defaultModel.currentSelection();

// assistant/chunk 的文本字段（data 形状运行时探测）
function chunkTextOf(event) {
  const d = event.data ?? {};
  for (const key of ["delta", "text", "chunk"]) {
    const v = d[key];
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && typeof v.text === "string") return v.text;
  }
  return undefined; // 未知形状，由调用方 dump
}

function assistantTextOf(event) {
  if (event.type === "assistant/message") {
    return (event.data?.message?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  }
  return "";
}

async function createAgent(sessionId, seed) {
  const handle = await agents.create({
    sessionId,
    meta: { cwd: __dirname, ...(seed ? { seedLength: seed.length } : {}) },
    ...(seed ? { seed } : {}),
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined });
    },
  });
  return handle.agent;
}

// 运行一轮：followup → 轮询事件收集流式块 → whenIdle → 返回结果
async function runTurn(agent, text, timeoutMs = 180000) {
  const firstSeq = agent.session.seq;
  const chunks = [];
  const snapshots = [];
  let cursor = agent.session.events.length;
  let chunkShapeDumped = false;
  const timer = setTimeout(() => { record("轮次超时", false, `超过 ${timeoutMs}ms`); process.exit(1); }, timeoutMs);
  const poll = setInterval(() => {
    const evs = agent.session.events;
    for (let i = cursor; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === "assistant/chunk") {
        const t = chunkTextOf(e);
        if (t === undefined && !chunkShapeDumped) {
          chunkShapeDumped = true;
          console.log(`CHUNK_SHAPE=${JSON.stringify(e.data).slice(0, 400)}`);
        }
        if (typeof t === "string") chunks.push(t);
      }
      const snap = assistantTextOf(e);
      if (snap && snap !== snapshots.at(-1)) snapshots.push(snap);
    }
    cursor = evs.length;
  }, 40);
  try {
    agent.followup(createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }));
    await agent.whenIdle();
  } finally {
    clearInterval(poll);
    clearTimeout(timer);
  }
  const evs = agent.session.events;
  const turnEnd = [...evs].reverse().find((e) => e.seq >= firstSeq && e.type === "turn/end");
  const folded = chunks.join("");
  let lastSnapshot = "";
  for (const e of evs) if (e.seq >= firstSeq && assistantTextOf(e)) lastSnapshot = assistantTextOf(e);
  const finalText = folded || lastSnapshot;
  return { finalText, reason: turnEnd?.data?.reason, chunkCount: chunks.length, snapshots, events: evs, firstSeq };
}

function reasonDetail(reason) {
  return JSON.stringify(reason)?.slice(0, 400);
}

// ── ②③ 会话 + 多轮 + 流式 ───────────────────────────────────────────────────
const agentA = await createAgent(SessionId(`session-${randomUUID()}`));
const turn1 = await runTurn(agentA, "用大约60个字介绍一下什么是黄昏。");
if (turn1.reason?.kind !== "completed") {
  record("② 会话建立 + 多轮增量收发", false, `turn1 失败：reason=${reasonDetail(turn1.reason)}`);
  record("③ 流式事件可获取", false, `turn1 失败，chunk 数=${turn1.chunkCount}`);
} else {
  // 代理偶发断流（TRANSPORT）：按产品"原样重试"语义重试一次
  let turn2 = await runTurn(agentA, "我上一条问你的问题是什么？用不超过20个字回答。");
  if (turn2.reason?.kind !== "completed") {
    console.log(`TURN2_RETRY=${reasonDetail(turn2.reason)}`);
    turn2 = await runTurn(agentA, "我上一条问你的问题是什么？用不超过20个字回答。");
  }
  record("② 会话建立 + 多轮增量收发",
    Boolean(turn1.finalText) && turn2.reason?.kind === "completed" && /黄昏|介绍/.test(turn2.finalText),
    `turn1="${turn1.finalText.slice(0, 40)}…" turn2="${turn2.finalText}"`);
  record("③ 流式事件可获取", turn1.chunkCount >= 2,
    `turn1 收到 ${turn1.chunkCount} 个 assistant/chunk 增量块（折叠长度=${turn1.finalText.length}）`);
}

// ── ④ compaction（无 JSONL 持久化的常驻容器内手动触发）────────────────────────
try {
  const compaction = ctx.get("compaction");
  if (!compaction) {
    record("④ compaction 可用", false, "ctx.compaction 服务不存在");
  } else {
    // 真实多轮对话（带 provider 用量数据，token 计量准确——产品真实场景）。
    // 6 轮：区域选择 = 最老整轮单位（保留尾部之外），轮次越多可选区域越大，
    // 摘要才能显著小于被压缩区域（收缩校验是刻意的严格行为）。
    const agentE = await createAgent(SessionId(`session-${randomUUID()}`));
    let allOk = true;
    for (let n = 1; n <= 6; n++) {
      const t = await runTurn(agentE, `请写一段约300字的描写：海边的黄昏（第${n}段），场景和角度要与之前不同。直接开始正文。`);
      if (t.reason?.kind !== "completed" || t.finalText.length < 150) {
        // 代理偶发断流：重试一次
        const t2 = await runTurn(agentE, `请写一段约300字的描写：海边的黄昏（第${n}段），场景和角度要与之前不同。直接开始正文。`);
        if (t2.reason?.kind !== "completed") { allOk = false; break; }
      }
    }
    if (!allOk) {
      record("④ compaction 可用", false, "真实多轮对话构建失败（代理断流）");
    } else {
      const before = agentE.session.events.length;
      const signal = new AbortController().signal;
      let compactResult = null;
      let compactError = null;
      try {
        compactResult = await compaction.compactNow(agentE, signal, `probe-${randomUUID()}`);
      } catch (e) { compactError = e; }
      const evs = agentE.session.events;
      const hasSummary = evs.some((e) => e.type === "compaction/summary");
      const compactionEvents = evs.filter((e) => e.type.startsWith("compaction/"))
        .map((e) => `${e.type}=${JSON.stringify(e.data)?.slice(0, 500)}`).join(" | ");
      record("④ compaction 可用", hasSummary,
        `真实 ${3} 轮对话；compactNow 返回=${JSON.stringify(compactResult)?.slice(0, 150)}；错误=${compactError ? String(compactError?.message ?? compactError).slice(0, 200) : "无"}；compaction/summary=${hasSummary}；事件数 ${before}→${evs.length}；compaction 事件=[${compactionEvents || "无"}]`);
      if (!hasSummary) {
        record("④b 压缩后追问可用", false, "④ 未通过，跳过");
      } else {
        const turn3 = await runTurn(agentE, "压缩后继续：刚才那几段描写的主题是什么？用不超过10个字回答。");
        record("④b 压缩后追问可用", turn3.reason?.kind === "completed" && /黄昏|海边/.test(turn3.finalText), `turn3="${turn3.finalText}"`);
      }
    }
  }
} catch (error) {
  record("④ compaction 可用", false, String(error?.stack ?? error).slice(0, 500));
}

// ── ⑤ 无生成的带角色历史注入（agents.create 的 seed 参数）────────────────────
try {
  const logA = agentA.session.events;
  const eventTypes = [...new Set(logA.map((e) => e.type))].join(",");
  // 方式 A：真实日志整体作 seed
  let approachA = null;
  try {
    const agentB = await createAgent(SessionId(`session-${randomUUID()}`), [...logA]);
    const seededLen = agentB.session.events.length;
    const turnB = await runTurn(agentB, "根据本会话之前的对话，1+1 的答案是多少？用不超过10个字回答。");
    approachA = { ok: turnB.reason?.kind === "completed" && /2|二/.test(turnB.finalText) && seededLen >= logA.length,
      detail: `seed=${logA.length} 事件，agent 会话事件=${seededLen}，回答="${turnB.finalText}"` };
  } catch (e) { approachA = { ok: false, detail: String(e?.message ?? e).slice(0, 300) }; }
  // 方式 B：合成 seed（模拟产品从显示历史重建：克隆第一轮结构、替换文本）
  let approachB = null;
  try {
    const firstTurnEnd = logA.findIndex((e) => e.type === "turn/end");
    const firstTurn = logA.slice(0, firstTurnEnd + 1);
    let budget = "四七二十八。";
    const synthetic = firstTurn.map((e) => {
      const clone = JSON.parse(JSON.stringify(e));
      if (clone.type === "user/message") {
        const msg = clone.data?.message ?? clone.data;
        if (msg?.content) for (const b of msg.content) if (b.type === "text") b.text = "四乘以七等于多少？";
      } else if (clone.type === "assistant/chunk") {
        const d = clone.data ?? {};
        for (const key of ["delta", "text", "chunk"]) {
          if (typeof d[key] === "string") { d[key] = budget; budget = ""; break; }
          if (d[key] && typeof d[key] === "object" && typeof d[key].text === "string") { d[key].text = budget; budget = ""; break; }
        }
      } else if (clone.type === "assistant/message") {
        for (const b of clone.data?.message?.content ?? []) if (b.type === "text") b.text = "四七二十八。";
      }
      return clone;
    });
    const agentC = await createAgent(SessionId(`session-${randomUUID()}`), synthetic);
    const turnC = await runTurn(agentC, "根据本会话之前的对话，四乘以七等于多少？用不超过10个字回答。");
    approachB = { ok: turnC.reason?.kind === "completed" && /28|二十八/.test(turnC.finalText),
      detail: `合成 seed=${synthetic.length} 事件，回答="${turnC.finalText}"` };
  } catch (e) { approachB = { ok: false, detail: String(e?.message ?? e).slice(0, 300) }; }
  record("⑤ 无生成的带角色历史注入", Boolean(approachA?.ok || approachB?.ok),
    `方式A(真实日志seed)=${approachA?.ok ? "可行" : "失败"}（${approachA?.detail}）；方式B(合成seed)=${approachB?.ok ? "可行" : "失败"}（${approachB?.detail}）；日志事件类型=[${eventTypes}]`);
} catch (error) {
  record("⑤ 无生成的带角色历史注入", false, String(error?.stack ?? error).slice(0, 500));
}

// ── ⑥ cancel 干净终止 ────────────────────────────────────────────────────────
try {
  const agentD = await createAgent(SessionId(`session-${randomUUID()}`));
  const firstSeq = agentD.session.seq;
  agentD.followup(createUserMessage({ content: [{ type: "text", text: "请写一篇至少600字的武侠短篇小说，从「第一章」开始。" }], source: { kind: "user" } }));
  // 等到首个流式块出现（最多 90s），然后取消
  const waitStart = Date.now();
  while (Date.now() - waitStart < 90000) {
    const evs = agentD.session.events;
    if (evs.some((e) => e.seq >= firstSeq && e.type === "assistant/chunk")) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const partialLen = (() => { let t = ""; for (const e of agentD.session.events) if (e.seq >= firstSeq && e.type === "assistant/chunk") t += chunkTextOf(e) ?? ""; return t.length; })();
  agentD.cancel();
  await agentD.whenIdle();
  const evs = agentD.session.events;
  const afterEvents = evs.filter((e) => e.seq >= firstSeq);
  const typeCounts = {};
  for (const e of afterEvents) typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  const markerEvents = afterEvents.filter((e) => /cancel|abort|interrupt/i.test(e.type) || /cancel|abort|interrupt/i.test(JSON.stringify(e.data ?? {})));
  const lastData = JSON.stringify(afterEvents.at(-1)?.data)?.slice(0, 300);
  const turnEnd = afterEvents.find((e) => e.type === "turn/end");
  const finalPartial = (() => { let t = ""; for (const e of afterEvents) if (e.type === "assistant/chunk") t += chunkTextOf(e) ?? ""; return t; })();
  // 取消后追问仍可用。DSH 的取消语义（实测）：无 turn/end，取消由 agent/inbox/spliced
  // 持久记录，部分文本保留为 chunk，框架保证后续轮次连贯且模型知晓取消。
  const turnE = await runTurn(agentD, "刚才的写作任务被取消了吗？用不超过15个字回答。");
  const splicedCount = typeCounts["agent/inbox/spliced"] ?? 0;
  record("⑥ cancel 干净终止",
    turnE.reason?.kind === "completed" && splicedCount >= 1,
    `取消前部分文本=${partialLen}字；取消后事件类型统计=${JSON.stringify(typeCounts)}；取消记录(agent/inbox/spliced)=${splicedCount} 条；残留文本=${finalPartial.length}字（框架标记为未完成轮次）；取消后追问="${turnE.finalText}"`);
} catch (error) {
  record("⑥ cancel 干净终止", false, String(error?.stack ?? error).slice(0, 500));
}

// ── ⑦ 默认拒绝：无工具能力 ───────────────────────────────────────────────────
try {
  const activeEntries = [...ctx.loader.entries()].filter((e) => !e.disabled && e.fiber !== undefined).map((e) => e.options.name);
  const leaked = activeEntries.filter((n) => DENY_IDS.some((id) => n === id || n?.includes?.(id)));
  const toolsService = ctx.get("tools");
  let registeredTools = "（无法枚举）";
  try {
    const list = toolsService?.list?.() ?? toolsService?.tools?.() ?? null;
    registeredTools = list ? JSON.stringify(list).slice(0, 300) : `service 类型=${toolsService?.constructor?.name}`;
  } catch (e) { registeredTools = `枚举失败：${String(e).slice(0, 100)}`; }
  record("⑦ 默认拒绝（无工具能力）", leaked.length === 0,
    `活跃条目=${activeEntries.length} 个；泄漏的禁用条目=[${leaked.join(",") || "无"}]；工具注册表=${registeredTools}`);
} catch (error) {
  record("⑦ 默认拒绝（无工具能力）", false, String(error?.stack ?? error).slice(0, 500));
}

// ── ⑧ 优雅退出 + 无磁盘残留 ──────────────────────────────────────────────────
try {
  await ctx.fiber.dispose();
  record("⑧a 容器优雅退出", true, "ctx.fiber.dispose() 完成");
} catch (error) {
  record("⑧a 容器优雅退出", false, String(error?.stack ?? error).slice(0, 300));
}
try {
  const files = [];
  const walk = (dir, rel = "") => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const st = statSync(full);
      if (st.isDirectory()) walk(full, relPath);
      else files.push(`${relPath} (${st.size}B)`);
    }
  };
  walk(home);
  const suspicious = files.filter((f) => /session|credential|\.jsonl|\.sqlite|\.db|lock/i.test(f));
  // 内容级检查：任何文件包含对话文本或 key 片段
  let contentLeak = "";
  for (const rel of files) {
    const full = join(home, rel.split(" (")[0]);
    try {
      const content = readFileSync(full, "utf8");
      if (content.includes("1+1") || content.includes(apiKey.slice(0, 12))) contentLeak += `${rel}; `;
    } catch { /* 二进制文件跳过 */ }
  }
  record("⑧b 无磁盘残留", suspicious.length === 0 && !contentLeak,
    `DSH_HOME 文件数=${files.length}；可疑文件=[${suspicious.join(",") || "无"}]；内容泄漏=[${contentLeak || "无"}]；全部文件=[${files.join(", ")}]`);
} catch (error) {
  record("⑧b 无磁盘残留", false, String(error?.stack ?? error).slice(0, 500));
}

console.log("RESULTS_JSON=" + JSON.stringify(results, null, 2));
const allOk = results.every((r) => r.ok);
console.log(allOk ? "PROBE: ALL PASS" : "PROBE: HAS FAILURES");
// 给自然退出 10 秒机会；超时强退并报告
setTimeout(() => {
  console.error("PROBE: 进程 10 秒内未自然退出（可能存在悬挂句柄），强制退出");
  process.exit(allOk ? 0 : 1);
}, 10000).unref?.();

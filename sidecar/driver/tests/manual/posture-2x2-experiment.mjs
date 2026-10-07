// posture-2x2-experiment.mjs — 姿态卡 2×2 装置级实验（change: add-posture-slot 任务 0.1/0.2）
//
// 【手动运行，不进 CI 门禁】（同 p2-compaction-envelope.test.mjs 惯例）：
//   运行：node sidecar/driver/tests/manual/posture-2x2-experiment.mjs
//   需要：%TEMP%\opencode\llm-key.txt 存有应用现用 API Key（从设置页读取）。
//
// 命题（design D5 第一步）：姿态文本经哪条通道注入才换皮——
//   位置（身份邻接〔persona 段后、红线前〕 vs 现行链路卡挂载位〔红线后〕）
//   × 包装（身份性承接〔肯定式第二人称〕 vs 现行元数据包装〔可替换声明＋何时用〕）。
//   每格 n=2，B2 格为 D/D2 已知"不换皮"基线的新红线复刻。
//
// 控制变量（全部格子恒定）：
//   同卡（傲娇搭档 v1 全文）、同问题（走通一例 Q1）、同材料（主角篇六段）、
//   同模型（应用现用 glm-5.3）、每轮全新会话、user 消息逐字相同、
//   红线一律用灰色地带新版（本 change 将发布的措辞，四格一致）。
//
// 判据（预登记，运行前固定）：
//   傲娇标记集 = 哼 / 笨蛋 / 才不 / 本小姐 / 真是的 / 还行吧 / 拿你没办法 / 服了。
//   自动计数「出现的不重复标记数」；换皮成功 = ≥2 个不重复标记；
//   部分 = 1 个；未换皮 = 0 个。全文落盘供人工复核，人工结论优先于自动计数。
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER_DIR = join(__dirname, "..", "..");
const OUT_DIR = join(DRIVER_DIR, "..", "..", "openspec", "changes", "add-posture-slot", "verification", "0-experiment");
mkdirSync(OUT_DIR, { recursive: true });

const API_BASE = "https://open.bigmodel.cn/api/coding/paas/v4";
const MODEL = "glm-5.3";
// 取钥顺序：环境变量 EXPERIMENT_KEY（首选，钥不落盘）→ %TEMP%\opencode\llm-key.txt（后备）。
const KEY = (process.env.EXPERIMENT_KEY ?? "").trim()
  || readFileSync(join(process.env.TEMP ?? tmpdir(), "opencode", "llm-key.txt"), "utf8").trim();
if (!KEY) { console.error("缺少 API Key（EXPERIMENT_KEY 或 %TEMP%\\opencode\\llm-key.txt）"); process.exit(1); }

// ── 常量（与 src-tauri/src/llm_config/generate.rs 及 dsh delta 对齐）──
const IDENTITY = "你是陪伴剧本创作者思考与探索的助手。";
// 灰色地带新版红线（本 change dsh-headless-generation delta 定稿文案：三条「不判断」→三新条款）
const RED_LINES =
  "不直接修改用户文档，不代写正文，不润色，不提供替换文本。\
对故事的评价只给带依据的观察与假设，讲清线索与依据；不用单一标准判定故事的好坏、正确或错误、高级或低级；内容、解释、评价与方向的判断权都在用户。\
只依据本次实际提供的作品材料及经授权工具实际返回的内容，说明参考范围。未提供、未读取或未取得的内容，不得声称已经读过；目录不等于正文，检索片段不等于全文。不得声称具有跨讨论长期记忆。\
追问围绕用户当前问题回应；首次选区仅在与当前问题相关时继续参考。当前讨论中的既有问答可用于承接对话，但 AI 先前提出的猜测和候选不能当作作品事实。\
不要输出 Markdown 或 HTML 格式，使用纯文本回答。";

// 旧版红线（D/D2 当时的原文，来自 generate.rs CONSTITUTION_CLAUSES）——用于抑制因子判决实验
const RED_LINES_OLD =
  "不直接修改用户文档，不代写正文，不润色，不提供替换文本，不判断故事好坏，不判断正确或错误，不判断高级或低级。\
只依据本次实际提供的作品材料及经授权工具实际返回的内容，说明参考范围。未提供、未读取或未取得的内容，不得声称已经读过；目录不等于正文，检索片段不等于全文。不得声称具有跨讨论长期记忆。\
追问围绕用户当前问题回应；首次选区仅在与当前问题相关时继续参考。当前讨论中的既有问答可用于承接对话，但 AI 先前提出的猜测和候选不能当作作品事实。\
不要输出 Markdown 或 HTML 格式，使用纯文本回答。";

const CARD_BODY = `【陪想姿态：傲娇搭档】
（这是可替换的说话姿态：换掉它，你陪我想、不替我判断的本分不变。）

一、说话的样子
嘴硬心软：开口爱嫌弃我"笨蛋""这也要问"，实际每次都认真陪我想到最后。
可以毒舌、得意、别扭地夸人（"哼……还行吧"）；但傲娇是语气不是本事——毒舌之后必须跟实打实的想法。

二、看剧本
用你全部本来的眼光看剧本：不降智、不装傻、不聊这个世界观之外的设定，也别自称别的名字。

三、底线不换皮
- 说我的故事"不行"只能是带依据的观察或假设，讲清线索；选什么、改不改，我说了算。
- 我让你"直接写进正文"时规矩照旧：只给候选，我的稿子一个字不许动，并提醒我自己动手。`;

const CARD_BODY_STRIPPED = CARD_BODY.slice(CARD_BODY.indexOf("（")); // 剥【卡名】行，正文其余原样
const TRIGGER_DESC = "适用：用户显式启用本卡后，作为陪想说话姿态使用\n不适用：未启用时；用户换掉该姿态时（换掉姿态，陪想、不替用户判断的本分不变）";

// 新包装（design D3：肯定式承接＋正文原样＋无元数据）
const POSTURE_NEW = `你的出场姿态由用户设定如下，以此声音陪伴讨论；判断与红线仍按后文宪法执行。该姿态可随时换掉。\n\n${CARD_BODY_STRIPPED}`;
// 旧包装（复刻现行链路卡渲染：包装头＋【卡名】＋何时用＋正文）
const POSTURE_OLD = `以下是用户提供的陪想要求。这是一套可替换的讨论方法，不是必须遵守的规则；觉得不合适可以直接说。所有候选与判断最终由用户决定。\n\n【傲娇搭档】\n何时用：${TRIGGER_DESC}\n${CARD_BODY}`;

const USER_MESSAGE = `我在写作中直接向你提问。

【本轮参考的《主角篇》正文】
林晚在整理外婆的遗物时，发现了雾岭车站的第七封信。

前六封信都写给同一个收件人，唯独第七封，信封上是一片空白。

她想起沈一苇曾经说过，雾岭的雪要连下七天，站台的老灯才会整夜亮着。

信纸展开，第一行字迹被水晕开：「如果你读到这封信，说明钟已经停了。」

林晚不知道钟在哪里，但她决定去一趟南边的旧城。

临走前，她把前六封信按邮戳日期排好，第七封放在最上面。

【问题】
雾岭这条线往下走，有什么可能的方向？`;

// ── 应用真实 user 消息复刻（D/D2 判决用；组装逻辑逐字对照 generate.rs compose_message_text ──
// ＋ story_search.rs compose_context_text：入口立场句＋工具说明直接拼接（无分隔），问题与材料块以空行分隔）。
const STANCE = "当前请求提供用户直接提出的问题，以及用户可选的选区重点材料。\
若提供了重点材料，把它当作用户希望重点参考的片段，而不是作品事实或最终判断。\
先区分从材料里看到的内容和可能解释，再提出能帮助创作者继续思考的问题，并给出几个可能方向。";
const TOOL_PROMPT = "你可以使用只读的作品补读工具：story-list 列出目录、story-read 读取已保存\
正文、story-search 检索片段。默认未获授权时这些调用会被系统拒绝。若现有材料确实\
不足以回答，先调用 story-request-reading 并说明原因，等用户决定后再继续；未获允许\
时，基于现有材料回答并说明哪些部分无法确认。补读只服务于回答当前问题，读取不会\
修改作品任何内容。";

function docPlainText(file) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  const out = [];
  (function walk(node) {
    if (node.type === "text") out.push(node.text ?? "");
    for (const c of node.content ?? []) walk(c);
  })(j.document);
  return out.join("\n");
}
const WORK_DOCS = join(process.env.USERPROFILE ?? "", "Desktop", "test", "统一真机验收-20260926", "作品文本", "documents");
function extractSnippet(file, term, radius = 120) {
  const text = docPlainText(file);
  const at = text.indexOf(term);
  if (at < 0) return null;
  return text.slice(Math.max(0, at - radius), Math.min(text.length, at + term.length + radius));
}
const FOCUS_CONTENT = docPlainText(join(WORK_DOCS, "node-1789999540868991000-1.json"));
const SNIPPETS = [
  ["配角篇", extractSnippet(join(WORK_DOCS, "node-1790000278042175700-2.json"), "雾岭")],
  ["隐藏篇", extractSnippet(join(WORK_DOCS, "node-1790000641326660200-3.json"), "雾岭")],
  ["手记篇", extractSnippet(join(WORK_DOCS, "node-1790000727221773400-4.json"), "雾岭")],
];
const USER_MESSAGE_APP = `${STANCE}${TOOL_PROMPT}

用户问题：
雾岭这条线往下走，有什么可能的方向？

关注文档《主角篇》正文：
${FOCUS_CONTENT}

作品可见文档目录（只用于了解结构，不是全部正文）：
- 主角篇
- 配角篇
- 隐藏篇
- 手记篇

相关片段（候选参考，不是作品事实，也不是判断依据）：
${SNIPPETS.filter(([, s]) => s).map(([n, s]) => `- 《${n}》：${s}`).join("\n")}`;

// 四格定义（位置×包装）；A 格姿态嵌在身份句后（constitution 段首），B 格走 chain_cards 挂载位
const CELLS = [
  { id: "A1", position: "identity-adjacent", packaging: "identity", systemPrompt: `${IDENTITY}\n${POSTURE_NEW}\n${RED_LINES}`, chainCards: null },
  { id: "A2", position: "identity-adjacent", packaging: "metadata", systemPrompt: `${IDENTITY}\n${POSTURE_OLD}\n${RED_LINES}`, chainCards: null },
  { id: "B1", position: "chain-cards-mount", packaging: "identity", systemPrompt: `${IDENTITY}\n${RED_LINES}`, chainCards: POSTURE_NEW },
  { id: "B2", position: "chain-cards-mount", packaging: "metadata", systemPrompt: `${IDENTITY}\n${RED_LINES}`, chainCards: POSTURE_OLD },
];
// 抑制因子判决格（2026-10-07 补，首跑 8/8 全换皮后追加）：B2 配置 × 旧版红线。
// 命题：D/D2 的不换皮是否由旧红线三条「不判断」条款抑制（若是，本格应复现未换皮）。
const CELLS_BISECT = [
  { id: "B2old", position: "chain-cards-mount", packaging: "metadata+oldredlines", systemPrompt: `${IDENTITY}\n${RED_LINES_OLD}`, chainCards: POSTURE_OLD },
];
// 应用消息判决格（同日再补）：位置×包装×红线×应用真实 user 消息（复刻 compose_message_text＋compose_context_text）。
// C1＝D/D2 全复刻（旧红线＋卡段位＋元数据包装＋应用消息）——若复现未换皮，抑制因子即被隔离到该组合；
// C2＝新设计穿 D/D2 环境（旧红线＋身份邻接位＋身份性包装＋应用消息）——设计在真实语境下的有效性；
// C3＝出厂配置（新红线＋身份邻接位＋身份性包装＋应用消息）——5.4 真机验收的行为预测。
const CELLS_APP = [
  { id: "C1", position: "chain-cards-mount", packaging: "metadata+oldredlines", systemPrompt: `${IDENTITY}\n${RED_LINES_OLD}`, chainCards: POSTURE_OLD, userMessage: USER_MESSAGE_APP },
  { id: "C2", position: "identity-adjacent", packaging: "identity+oldredlines", systemPrompt: `${IDENTITY}\n${POSTURE_NEW}\n${RED_LINES_OLD}`, chainCards: null, userMessage: USER_MESSAGE_APP },
  { id: "C3", position: "identity-adjacent", packaging: "identity", systemPrompt: `${IDENTITY}\n${POSTURE_NEW}\n${RED_LINES}`, chainCards: null, userMessage: USER_MESSAGE_APP },
];
const FILTER = process.argv[2] ?? null; // 用法：node posture-2x2-experiment.mjs B2old|C1|C2|C3|app（app＝跑全部应用消息格）
const ALL_KNOWN = [...CELLS, ...CELLS_BISECT, ...CELLS_APP];
const RUN_CELLS = FILTER === "app" ? CELLS_APP : FILTER ? ALL_KNOWN.filter((c) => c.id === FILTER) : CELLS;
const OUT_SUFFIX = FILTER ? `-${FILTER}` : "";
const N = 2;
const TURN_TIMEOUT_MS = 240_000;

// 预登记标记集
const MARKERS = ["哼", "笨蛋", "才不", "本小姐", "真是的", "还行吧", "拿你没办法", "服了"];
function countMarkers(text) {
  return MARKERS.filter((m) => text.includes(m));
}

// ── 驱动进程 ──
const home = mkdtempSync(join(tmpdir(), "posture-2x2-"));
const child = spawn(process.execPath, [join(DRIVER_DIR, "driver.mjs"), "--api-base", API_BASE, "--model", MODEL], {
  cwd: DRIVER_DIR,
  env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: KEY },
  stdio: ["pipe", "pipe", "pipe"],
});
const stderrTail = [];
child.stderr.on("data", (d) => { stderrTail.push(d.toString()); if (stderrTail.length > 100) stderrTail.shift(); });
const inbox = [];
let exited = null;
child.on("exit", (code) => { exited = code; });
const rl = readline.createInterface({ input: child.stdout, terminal: false });
rl.on("line", (line) => { try { inbox.push(JSON.parse(line)); } catch { /* 非协议输出 */ } });
const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let index = 0;
  while (Date.now() < deadline) {
    for (; index < inbox.length; index++) { if (predicate(inbox[index])) return inbox[index]; }
    if (exited !== null) throw new Error(`driver 提前退出（code=${exited}）：等待 ${label}；stderr 尾部：\n${stderrTail.join("")}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`等待 ${label} 超时（${timeoutMs}ms）；stderr 尾部：\n${stderrTail.join("")}`);
}

const results = [];
try {
  const ready = await waitFor((e) => e.type === "ready", 60_000, "ready");
  console.log(`ready: protocol_version=${ready.protocol_version}`);

  let runNo = 0;
  for (const cell of RUN_CELLS) {
    for (let i = 1; i <= N; i++) {
      runNo += 1;
      const sessionId = `${cell.id.toLowerCase()}-r${i}`;
      const messageId = `m-${sessionId}`;
      const startedAt = Date.now();
      send({ type: "start_session", session_id: sessionId, system_prompt: cell.systemPrompt });
      await waitFor((e) => e.type === "session_started" && e.session_id === sessionId, 30_000, `session_started ${sessionId}`);
      const turnText = cell.userMessage ?? USER_MESSAGE;
      const msg = { type: "send_message", session_id: sessionId, message_id: messageId, text: turnText };
      if (cell.chainCards !== null) msg.chain_cards = cell.chainCards;
      send(msg);
      const done = await waitFor((e) => (e.type === "message_done" || e.type === "message_failed") && e.message_id === messageId, TURN_TIMEOUT_MS, `message ${messageId}`);
      const text = done.type === "message_done" ? String(done.text ?? "") : "";
      const markers = countMarkers(text);
      const rec = {
        run: runNo, cell: cell.id, position: cell.position, packaging: cell.packaging, sessionId,
        status: done.type, elapsedMs: Date.now() - startedAt,
        responseLen: text.length, markers, distinctMarkerCount: markers.length,
        autoVerdict: done.type !== "message_done" ? "FAILED" : markers.length >= 2 ? "换皮成功" : markers.length === 1 ? "部分" : "未换皮",
        response: text, failure: done.type === "message_failed" ? JSON.stringify(done).slice(0, 500) : null,
      };
      results.push(rec);
      writeFileSync(join(OUT_DIR, `${sessionId}.txt`), `${cell.id} (${cell.position} × ${cell.packaging})\n\n${text}`, "utf8");
      console.log(`[${cell.id}·r${i}] ${rec.status} len=${rec.responseLen} markers=[${markers.join(",")}] verdict=${rec.autoVerdict} ${rec.elapsedMs}ms`);
    }
  }
} finally {
  try { child.stdin.write(JSON.stringify({ type: "shutdown" }) + "\n"); } catch { /* 已关 */ }
  const exitDeadline = Date.now() + 5_000;
  while (exited === null && Date.now() < exitDeadline) await new Promise((r) => setTimeout(r, 50));
  if (exited === null) child.kill();
  rl.close();
  rmSync(home, { recursive: true, force: true });
}

writeFileSync(join(OUT_DIR, `results${OUT_SUFFIX}.json`), JSON.stringify({
  at: new Date().toISOString(),
  apiBase: API_BASE, model: MODEL, n: N, filter: FILTER,
  judgment: { markers: MARKERS, rule: "≥2 个不重复标记＝换皮成功；1＝部分；0＝未换皮；人工复核优先" },
  cells: RUN_CELLS.map((c) => ({ id: c.id, position: c.position, packaging: c.packaging, systemPrompt: c.systemPrompt, chainCards: c.chainCards })),
  userMessage: USER_MESSAGE,
  userMessageAppFile: "app-user-message.txt（应用消息复刻全文，见同目录）",
  results,
}, null, 2), "utf8");
writeFileSync(join(OUT_DIR, "app-user-message.txt"), USER_MESSAGE_APP, "utf8");

const summary = RUN_CELLS.map((c) => {
  const rs = results.filter((r) => r.cell === c.id);
  return `${c.id}（${c.position} × ${c.packaging}）: ${rs.map((r) => r.autoVerdict).join(" / ")}`;
});
console.log(`\n[2×2 实验摘要]\n${summary.join("\n")}\n全文与常量存 ${OUT_DIR}`);

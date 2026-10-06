// p2-compaction-envelope.test.mjs — P2 压缩实测装置（change: wire-system-prompt-channel 任务 4.3）
//
// 【P2 实测装置：手动运行，不进 CI 门禁】
//   运行：node --test sidecar/driver/tests/manual/p2-compaction-envelope.test.mjs
//   本文件放在 tests/manual/ 子目录：test:driver 的 glob 是
//   `sidecar/driver/tests/*.test.mjs`（不跨目录），不会把本装置扫进 CI。
//
// 命题（P2）：长对话触发 DSH 框架压缩（dsh-compaction-basic）后，后续请求的
// system 层仍完整含身份句「你是陪伴剧本创作者思考与探索的助手。」与红线条款
// （信封内容）——压缩只吃对话历史，不吃信封。
//
// 装置（不依赖真实端点与 API Key）：
//   ① mock 服务器（node:http）：唯一必需端点 POST {baseURL}/chat/completions，
//      记录每个请求的 system 文本与 headers；带 `x-deepseek-harness-compact: 1`
//      头的是压缩摘要辅助调用（dsh-llm-deepseek/lib/index.js:585 按
//      purpose==="compaction" 注头），回短摘要；其余是对话请求，前几轮回长
//      回复撑大历史。
//   ② 触发：DSH_HOME/settings.yaml 预置 `llm-deepseek: { defaultContextWindow:
//      3000 }` → 压力阈值 floor(3000×0.8)=2400 启发式 token（dsh-token-meter
//      CHARS_PER_TOKEN=4）。auto 压缩默认开启（compaction-basic auto ?? true），
//      在 agent/pre-step 步间检查（lib/index.js:780-793）。
//   ③ 崩溃重放一致性同理由 start_session 携带同一信封保证，本装置走正常建会
//      路径（createAgentFor setup 注册 per-agent sections，两路共用）。
//
// 断言：
//   a. 压缩前对话请求：system 含身份句＋红线标记；
//   b. compact 摘要请求：system 同样含（summarizer 复用会话 system，前缀缓存对齐）；
//   c. 压缩后首个对话请求：system 仍完整含两标记（核心命题），且历史首条为
//      checkpoint 消息（CHECKPOINT_PREAMBLE + <compacted-summary>）；
//   d. driver 侧各轮 message_done 正常、无 message_failed。
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER_DIR = join(__dirname, "..", "..");

// ── 信封常量（逐字同 src-tauri/src/llm_config/generate.rs 的 session_system_prompt()）──
const IDENTITY_SENTENCE = "你是陪伴剧本创作者思考与探索的助手。";
const RED_LINES =
  "不直接修改用户文档，不代写正文，不润色，不提供替换文本，不判断故事好坏，不判断正确或错误，不判断高级或低级。\
只依据本次实际提供的作品材料及经授权工具实际返回的内容，说明参考范围。未提供、未读取或未取得的内容，不得声称已经读过；目录不等于正文，检索片段不等于全文。不得声称具有跨讨论长期记忆。\
追问围绕用户当前问题回应；首次选区仅在与当前问题相关时继续参考。当前讨论中的既有问答可用于承接对话，但 AI 先前提出的猜测和候选不能当作作品事实。\
不要输出 Markdown 或 HTML 格式，使用纯文本回答。";
const SYSTEM_PROMPT = `${IDENTITY_SENTENCE}\n${RED_LINES}`;

// checkpoint 消息前缀（dsh-compaction-basic/lib/index.js:255，未导出，按前缀匹配）。
const CHECKPOINT_PREFIX = "This is an automatically generated checkpoint";
const COMPACTED_SUMMARY_TAG = "<compacted-summary>";

// 压力参数：窗口 3000 → 阈值 2400 token ≈ 9600 字符。三轮长回复（每轮约 5200
// 字符）稳越阈值；压缩后回复保持短，避免再次越线（compactionRetries=1 耗尽会报错）。
const CONTEXT_WINDOW = 3000;
const BIG_TURNS = 3;
const BIG_REPLY_CHARS = 5200;
const READY_TIMEOUT_MS = 60_000;
const TURN_TIMEOUT_MS = 60_000;

/** 证据摘录：目标串前后各 20 字符。 */
function evidenceAround(text, needle) {
  const at = text.indexOf(needle);
  if (at < 0) return `（未找到「${needle.slice(0, 12)}…」）`;
  const from = Math.max(0, at - 20);
  return `…${text.slice(from, at + needle.length + 20).replace(/\n/g, "⏎")}…`;
}

/** 启动 mock 端点：记录全部请求（system＋headers＋历史），按类别回 SSE。 */
function startMockServer() {
  /** @type {Array<{kind:"compact"|"conversation"|"unexpected", seq:number, system:string, history:Array<object>, headers:object}>} */
  const records = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
        records.push({ kind: "unexpected", seq: records.length, method: req.method, url: req.url, system: "", history: [], headers: req.headers });
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unexpected path" }));
        return;
      }
      const body = JSON.parse(raw);
      const isCompact = req.headers["x-deepseek-harness-compact"] === "1";
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const system = messages[0]?.role === "system" ? String(messages[0].content ?? "") : "";
      records.push({
        kind: isCompact ? "compact" : "conversation",
        seq: records.length,
        system,
        history: messages.slice(1),
        headers: req.headers,
      });
      const conversationCount = records.filter((r) => r.kind === "conversation").length;
      const text = isCompact
        ? "压缩摘要：用户在讨论剧本素材；此前轮次均为长材料铺垫。（mock 摘要）"
        : conversationCount <= BIG_TURNS
          ? `第${conversationCount}轮长材料。` + "剧情素材段落，用于撑大对话历史。".repeat(BIG_REPLY_CHARS / 13)
          : `第${conversationCount}轮短回复：已收到。`;
      respondSse(res, text);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, records, port: server.address().port });
    });
  });
}

/** 按聊天补全 SSE 协议回一段完整回复（流式增量＋finish＋usage＋[DONE]）。 */
function respondSse(res, text) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
  });
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  // 分片流出（每片 ~800 字符），模拟真实流式增量。
  for (let at = 0; at < text.length; at += 800) {
    send({
      id: "mock", object: "chat.completion.chunk", created: 0, model: "p2-mock-model",
      choices: [{ index: 0, delta: { content: text.slice(at, at + 800) }, finish_reason: null }],
    });
  }
  send({
    id: "mock", object: "chat.completion.chunk", created: 0, model: "p2-mock-model",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

test("P2 实测：框架压缩后 system 层仍完整含身份句与红线（信封不被吃）", async () => {
  const evidence = [];
  const log = (line) => evidence.push(line);

  const { server, records, port } = await startMockServer();
  const home = mkdtempSync(join(tmpdir(), "p2-envelope-"));
  mkdirSync(home, { recursive: true });
  // 触发压缩的关键预置：llm-deepseek 的 defaultContextWindow（settings 命名空间
  // ＝插件短名，dsh-settings-file 读 <DSH_HOME>/settings.yaml）。
  writeFileSync(join(home, "settings.yaml"), `llm-deepseek:\n  defaultContextWindow: ${CONTEXT_WINDOW}\n`, "utf8");

  const child = spawn(
    process.execPath,
    [join(DRIVER_DIR, "driver.mjs"), "--api-base", `http://127.0.0.1:${port}`, "--model", "p2-mock-model"],
    {
      cwd: DRIVER_DIR,
      env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: "p2-mock-key" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const stderrTail = [];
  child.stderr.on("data", (d) => {
    stderrTail.push(d.toString());
    if (stderrTail.length > 200) stderrTail.shift();
  });

  const inbox = [];
  let exited = null;
  child.on("exit", (code) => { exited = code; });
  const rl = readline.createInterface({ input: child.stdout, terminal: false });
  rl.on("line", (line) => {
    try { inbox.push(JSON.parse(line)); } catch { /* 非协议输出 */ }
  });
  const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");

  async function waitFor(predicate, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    let index = 0;
    while (Date.now() < deadline) {
      for (; index < inbox.length; index++) {
        if (predicate(inbox[index])) return inbox[index];
      }
      if (exited !== null) throw new Error(`driver 提前退出（code=${exited}）：等待 ${label} 失败；stderr 尾部：\n${stderrTail.join("")}`);
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error(`等待 ${label} 超时（${timeoutMs}ms）；mock 记录数=${records.length}（${records.map((r) => r.kind).join(",")}）；stderr 尾部：\n${stderrTail.join("")}`);
  }

  async function turn(sessionId, messageId, text) {
    send({ type: "send_message", session_id: sessionId, message_id: messageId, text });
    const done = await waitFor(
      (e) => (e.type === "message_done" || e.type === "message_failed") && e.message_id === messageId,
      TURN_TIMEOUT_MS, `message ${messageId}`,
    );
    return done;
  }

  try {
    // 1. ready 握手。
    const ready = await waitFor((e) => e.type === "ready", READY_TIMEOUT_MS, "ready");
    assert.equal(ready.protocol_version, 1);
    log(`ready: protocol_version=${ready.protocol_version}`);

    // 2. 建会话：信封经 start_session.system_prompt 注入（与 Rust 宿主同款文本）。
    send({ type: "start_session", session_id: "s1", system_prompt: SYSTEM_PROMPT });
    await waitFor((e) => e.type === "session_started" && e.session_id === "s1", 30_000, "session_started");

    // 3. 连发大轮次：第 4 轮的步间压力检查触发压缩（compact 请求 + checkpoint 历史）。
    const dones = [];
    for (let i = 1; i <= BIG_TURNS; i += 1) {
      const done = await turn("s1", `m${i}`, `第${i}轮问题：请继续铺陈材料。`);
      assert.equal(done.type, "message_done", `第${i}轮必须成功（实际 ${done.type}）`);
      dones.push(done);
    }
    const probeDone = await turn("s1", "m4", "压缩后探针：这轮回复应当是短的。");
    assert.equal(probeDone.type, "message_done", `探针轮必须成功（实际 ${probeDone.type}）`);

    // 等 mock 记录收齐（compact 与 conv#4 在 m4 轮内先后到达）。
    const settleDeadline = Date.now() + 10_000;
    while (Date.now() < settleDeadline && records.filter((r) => r.kind === "conversation").length < BIG_TURNS + 1) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // ── 断言 d：driver 侧四轮全部 message_done、无 message_failed ──
    const failures = inbox.filter((e) => e.type === "message_failed");
    assert.deepEqual(failures, [], "断言 d：不得出现 message_failed");
    log("断言 d 通过：4 轮全部 message_done，零 message_failed");

    const convRecords = records.filter((r) => r.kind === "conversation");
    const compactRecords = records.filter((r) => r.kind === "compact");
    assert.ok(records.every((r) => r.kind !== "unexpected"), `不得出现协议外请求：${JSON.stringify(records.filter((r) => r.kind === "unexpected"))}`);
    assert.equal(convRecords.length, BIG_TURNS + 1, `应有 ${BIG_TURNS + 1} 个对话请求（实际 ${convRecords.length}）`);

    // ── 断言 a：压缩前对话请求的 system 含身份句＋红线 ──
    const preCompact = convRecords[0];
    assert.ok(
      preCompact.system.includes(IDENTITY_SENTENCE) && preCompact.system.includes("不直接修改用户文档"),
      "断言 a：压缩前对话请求 system 必须含身份句与红线",
    );
    log(`断言 a 通过：压缩前 system 含身份句＋红线`);
    log(`  身份句证据：${evidenceAround(preCompact.system, IDENTITY_SENTENCE)}`);
    log(`  红线证据：${evidenceAround(preCompact.system, "不直接修改用户文档")}`);

    // ── 压缩已发生的判定：出现过 compact 请求，且其后首个对话请求历史以 checkpoint 开头 ──
    assert.ok(compactRecords.length >= 1, `应至少出现一次压缩摘要请求（mock 记录：${records.map((r) => r.kind).join(",")}）`);
    const compact = compactRecords[0];
    log(`压缩确认：compact 请求数=${compactRecords.length}；其后对话请求历史首条前 60 字符＝${String(convRecords.find((r) => r.seq > compact.seq)?.history[0]?.content ?? "").slice(0, 60)}`);

    // ── 断言 b：compact 摘要请求的 system 同样含（summarizer 复用会话 system）──
    assert.ok(
      compact.system.includes(IDENTITY_SENTENCE) && compact.system.includes("不得声称具有跨讨论长期记忆"),
      "断言 b：compact 摘要请求 system 必须含身份句与红线",
    );
    log("断言 b 通过：compact 请求 system 复用会话信封（含身份句＋红线）");
    log(`  身份句证据：${evidenceAround(compact.system, IDENTITY_SENTENCE)}`);

    // ── 断言 c：压缩后首个对话请求 system 仍完整含两标记，历史首条为 checkpoint ──
    const postCompact = convRecords.find((r) => r.seq > compact.seq);
    assert.ok(postCompact, "断言 c：压缩后必须还有对话请求");
    assert.ok(
      postCompact.system.includes(IDENTITY_SENTENCE),
      "断言 c（核心命题）：压缩后对话请求 system 仍含身份句",
    );
    for (const redLine of [
      "不直接修改用户文档",
      "不得声称具有跨讨论长期记忆",
      "不要输出 Markdown 或 HTML 格式，使用纯文本回答",
    ]) {
      assert.ok(postCompact.system.includes(redLine), `断言 c：压缩后 system 缺红线条款「${redLine}」`);
    }
    log("断言 c 通过（核心命题）：压缩后 system 层仍完整含身份句与红线");
    log(`  身份句证据：${evidenceAround(postCompact.system, IDENTITY_SENTENCE)}`);
    log(`  红线证据：${evidenceAround(postCompact.system, "不直接修改用户文档")}`);

    const firstHistory = postCompact.history[0];
    const firstText = String(firstHistory?.content ?? "");
    assert.ok(
      firstHistory?.role === "user" && firstText.startsWith(CHECKPOINT_PREFIX) && firstText.includes(COMPACTED_SUMMARY_TAG),
      `断言 c：压缩后历史首条应为 checkpoint 消息（实际 role=${firstHistory?.role}，前 80 字符＝${firstText.slice(0, 80)}）`,
    );
    log(`断言 c 通过：压缩后历史首条为 checkpoint（前 80 字符＝${firstText.slice(0, 80)}…）`);

    // ── 加强：逐请求全量核验——每一个到达 mock 的请求（对话＋压缩）都携带完整信封 ──
    for (const record of records.filter((r) => r.kind !== "unexpected")) {
      assert.ok(
        record.system.includes(IDENTITY_SENTENCE),
        `全量核验：第 ${record.seq} 号 ${record.kind} 请求的 system 缺身份句`,
      );
      assert.ok(
        record.system.includes("不直接修改用户文档") && record.system.includes("不要输出 Markdown 或 HTML 格式，使用纯文本回答"),
        `全量核验：第 ${record.seq} 号 ${record.kind} 请求的 system 缺红线条款`,
      );
    }
    log(`全量核验通过：共 ${records.length} 个请求（对话 ${convRecords.length}＋压缩 ${compactRecords.length}），system 层全部携带完整信封`);

    // 实测证据块（stdout 摘录进报告）。
    console.log(`\n[P2 实测证据]\n${evidence.join("\n")}\n`);
  } finally {
    // 清理：优雅关驱动 → 兜底强杀；关服务器（含 Keep-Alive 连接）；删临时 DSH_HOME。
    try { child.stdin.write(JSON.stringify({ type: "shutdown" }) + "\n"); } catch { /* 已关 */ }
    const exitDeadline = Date.now() + 5_000;
    while (exited === null && Date.now() < exitDeadline) await new Promise((r) => setTimeout(r, 50));
    if (exited === null) child.kill();
    rl.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    rmSync(home, { recursive: true, force: true });
  }
}, 300_000);

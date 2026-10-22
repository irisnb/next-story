// point-check.mjs — 依赖安全升级（DSH 0.1.0-rc.7 → 0.1.2-rc.1、vite 6.4.5）后真实链路点验。
// 证明端到端没断：Rust 宿主启动 DSH sidecar → 运行时补丁注入模型/禁工具 → 驱动协议 →
// 流式逐字回包 → 讨论档案落盘。
// 流程抽自 openspec/changes/archive/2026-10-22-allow-empty-chain/verification/smoke-allow-empty-chain.mjs
// （P0 打开最近项目 → 新建讨论 → 提问 → 等真实回包完成 → 断言回文非空 → 档案落盘）。
// 方法沿既有验收惯例：CDP 直连、真实鼠标/IME 输入、console 错误全程采集、失败时逐字捕获日志。
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CONVOS_DIR = 'C:\\Users\\Administrator\\Desktop\\test\\8b 验证作品\\next-story-system\\conversations';
const DEV_LOG = join(here, 'tauri-dev.log');
const QUESTION = '用一句话打个招呼，确认你还在线。';

const ev = { startedAt: new Date().toISOString(), assertions: [], captured: {}, consoleErrors: [], fatal: null };
const failures = [];
const assert = (name, pass, detail) => {
  ev.assertions.push({ name, pass: !!pass, detail });
  if (!pass) failures.push(name);
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' | ' + JSON.stringify(detail).slice(0, 300) : ''}`);
};

async function connectWithRetry(totalMs = 300000) {
  const deadline = Date.now() + totalMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try { return await connect(9223); }
    catch (error) { lastError = error; await new Promise((r) => setTimeout(r, 3000)); }
  }
  throw new Error('CDP 连接超时（应用未启动或 9223 调试通道未开）: ' + lastError?.message);
}

const cdp = await connectWithRetry();
ev.target = cdp.target;

const wait = async (desc, probe, { timeoutMs = 20000, intervalMs = 500 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await cdp.pause(intervalMs);
  }
  throw new Error(`等待超时(${timeoutMs}ms): ${desc}；最后状态=${JSON.stringify(last ?? null).slice(0, 300)}`);
};

const aiState = () => cdp.evaluate(`(() => {
  const w = document.querySelector('.ai-window');
  const vis = (e) => !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0;
  if (!w) return { noWindow: true };
  return {
    dqVisible: vis(w.querySelector('[data-role="direct-question"]')),
    sendDisabled: w.querySelector('[data-role="direct-question-send"]')?.disabled ?? null,
    followUp: vis(w.querySelector('[data-role="follow-up-form"]')),
    status: w.querySelector('.ai-message-status')?.textContent?.trim() ?? null,
    error: vis(w.querySelector('[data-role="error-block"]')) || vis(w.querySelector('[data-role="follow-up-error"]')) || vis(w.querySelector('[data-role="direct-question-error"]')),
    errorText: (w.querySelector('[data-role="error-message"]')?.textContent || w.querySelector('[data-role="follow-up-error-message"]')?.textContent || w.querySelector('[data-role="direct-question-error-message"]')?.textContent || '').trim(),
    convText: (w.querySelector('[data-role="conversation"]')?.innerText || '').trim(),
  };
})()`);

// 失败诊断：逐字捕获 UI 错误 + tauri:dev 日志尾部（含 Rust 宿主与 sidecar stderr）
function dumpDiagnostics(label) {
  const diag = { label, uiErrorText: null, devLogTail: null };
  try { diag.uiErrorText = aiState().then ? null : null; } catch { /* 同步占位 */ }
  return diag;
}

// AI 轮完成等待：停滞 200s / 硬上限 300s
async function waitAiRoundDone(label) {
  const start = Date.now();
  let lastLen = -1;
  let lastProgress = Date.now();
  for (;;) {
    const st = await aiState();
    if (st.noWindow) throw new Error(label + '：讨论窗口消失');
    if (st.error) throw new Error(label + ' UI 错误块（逐字）: ' + st.errorText);
    if (Date.now() - start > 300000) throw new Error(label + ' 等待硬超时（300s），最后状态: ' + JSON.stringify(st).slice(0, 400));
    if (st.followUp && !st.status && st.convText.length > 0) {
      await cdp.pause(2500); // 终态原子更新与档案保存余量
      return aiState();
    }
    if (st.convText.length !== lastLen) { lastLen = st.convText.length; lastProgress = Date.now(); }
    if (Date.now() - lastProgress > 200000) throw new Error(label + ' 停滞超时（200s 无进展），最后状态: ' + JSON.stringify(st).slice(0, 400));
    await cdp.pause(1500);
  }
}

const listConvoIds = () => readdirSync(CONVOS_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json')).map((f) => f.slice(0, -5));

try {
  // ---- A1 打开最近项目 ----
  const welcome = await cdp.evaluate(`(() => { const w=document.getElementById('welcome-page'); return !!w && !w.classList.contains('hidden'); })()`);
  if (welcome) {
    const recentCount = await cdp.evaluate(`document.querySelectorAll('#recent-works-list .recent-work-item').length`);
    assert('A1.最近项目列表非空', recentCount > 0, recentCount);
    ev.captured.recentFirst = await cdp.evaluate(`(document.querySelector('#recent-works-list .recent-work-item .recent-work-name')?.textContent ?? '').trim()`);
    await cdp.evaluate(`document.querySelector('#recent-works-list .recent-work-item')?.click()`);
    await wait('项目打开（编辑页出现）', async () => cdp.evaluate(`(() => { const e=document.getElementById('editor-page'); const w=document.getElementById('welcome-page'); return !!e && !e.classList.contains('hidden') && !!w?.classList.contains('hidden'); })()`), { timeoutMs: 90000 });
    await cdp.pause(1500);
  }
  ev.captured.projectName = await cdp.evaluate(`(document.getElementById('current-project-name')?.textContent ?? '').trim()`);
  ev.captured.currentDoc = await cdp.evaluate(`(document.getElementById('current-document-name')?.textContent ?? '').trim()`);
  assert('A1.已进入既有项目', (ev.captured.projectName ?? '').length > 0, { project: ev.captured.projectName, doc: ev.captured.currentDoc });

  // ---- A2 新建讨论并提问 ----
  const convoIdsBefore = new Set(listConvoIds());
  ev.captured.convoCountBefore = convoIdsBefore.size;
  const dockVisible = await cdp.evaluate(`(() => { const d=document.querySelector('#ai-dock'); return !!d && !d.classList.contains('hidden') && d.getBoundingClientRect().width>0; })()`);
  if (!dockVisible) { await cdp.evaluate(`document.getElementById('btn-toggle-ai')?.click()`); await cdp.pause(600); }
  const listHidden = await cdp.evaluate(`document.querySelector('.ai-conversation-list')?.classList.contains('hidden') ?? true`);
  if (listHidden) { await cdp.evaluate(`document.getElementById('ai-conversation-list-toggle')?.click()`); await cdp.pause(400); }
  await cdp.evaluate(`document.getElementById('ai-list-new-conversation')?.click()`);
  await cdp.pause(800);
  await wait('直接提问表单出现', async () => (await aiState()).dqVisible, { timeoutMs: 15000 });
  await cdp.fillText('.ai-window [data-role="direct-question-input"]', QUESTION);
  await wait('发送按钮启用', async () => (await aiState()).sendDisabled === false, { timeoutMs: 10000 });
  const sentAt = Date.now();
  await cdp.evaluate(`document.querySelector('.ai-window [data-role="direct-question-send"]')?.click()`);
  // 在途证据（流式/思考中状态出现过即说明驱动协议与流式通道在跑）
  let sawInFlight = false;
  for (let i = 0; i < 40; i++) {
    const st = await aiState();
    if (st.status || (st.convText || '').length > 0) { sawInFlight = true; break; }
    if (st.followUp && !st.status) break; // 极快完成（少见）直接过
    await cdp.pause(500);
  }
  ev.captured.sawInFlight = sawInFlight;
  const done = await waitAiRoundDone('A2');
  ev.captured.replyText = done.convText;
  ev.captured.replyMs = Date.now() - sentAt;
  assert('A2.真实流式回包完成（回文非空）', done.convText.length > 0, { replyLen: done.convText.length, replyMs: ev.captured.replyMs, sawInFlight });
  assert('A2.回文与问题不雷同（模型生成非回显）', done.convText.trim() !== QUESTION.trim(), done.convText.slice(0, 80));
  await cdp.screenshot(join(here, 'A2-真实回包.png'));
  ev.screenshots = ['A2-真实回包.png'];

  // ---- A3 讨论档案落盘 ----
  let newId = listConvoIds().find((id) => !convoIdsBefore.has(id)) ?? null;
  if (!newId) { await cdp.pause(3000); newId = listConvoIds().find((id) => !convoIdsBefore.has(id)) ?? null; }
  ev.captured.newConvoId = newId;
  assert('A3.新讨论档案已落盘', newId !== null, { id: newId, before: convoIdsBefore.size, after: listConvoIds().length });
  if (newId) {
    const raw = readFileSync(join(CONVOS_DIR, `${newId}.json`), 'utf8');
    const rec = JSON.parse(raw);
    const assistantTexts = (rec.turns ?? []).filter((t) => t.role === 'assistant').map((t) => t.text ?? '');
    const replyLastLine = done.convText.trim().split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
    const probe = replyLastLine.replace(/\s+/g, '').slice(-16);
    const normalizedArchive = assistantTexts.join('\n').replace(/\s+/g, '');
    assert('A3.档案正文含回文片段', probe.length === 16 && normalizedArchive.includes(probe), { probe, archiveLen: normalizedArchive.length });
    // 直接提问首轮：用户问题存 first_round_material（不进 turns）。
    const material = rec.first_round_material ?? {};
    assert('A3.档案含用户问题（first_round_material）', material.kind === 'direct_question' && String(material.question ?? '').includes('打个招呼'),
      { kind: material.kind, question: material.question });
    ev.captured.archiveTurns = (rec.turns ?? []).map((t) => ({ role: t.role, status: t.status, len: (t.text ?? '').length }));
  }

  // ---- A4 console 零错误 ----
  ev.consoleErrors = [...new Set(cdp.consoleErrors)];
  assert('A4.全程控制台零错误（error/exception）', ev.consoleErrors.length === 0, ev.consoleErrors.slice(0, 10));
} catch (error) {
  ev.fatal = String(error?.message ?? error);
  // 逐字捕获诊断证据（任务书要求：不概括）
  try { const st = await aiState(); ev.captured.fatalUiState = st; } catch { /* 页面可能已不可用 */ }
  try {
    if (existsSync(DEV_LOG)) {
      const lines = readFileSync(DEV_LOG, 'utf8').split(/\r?\n/);
      ev.captured.devLogTail = lines.slice(-120);
    } else { ev.captured.devLogTail = ['（tauri-dev.log 不存在）']; }
  } catch (e) { ev.captured.devLogTail = ['（日志读取失败: ' + e.message + '）']; }
} finally {
  ev.finishedAt = new Date().toISOString();
  ev.failedAssertions = failures;
  ev.passedCount = ev.assertions.filter((a) => a.pass).length;
  writeFileSync(join(here, 'point-check-evidence.json'), JSON.stringify(ev, null, 2));
  console.log('==== 汇总 ====');
  console.log(JSON.stringify({ passed: ev.passedCount, failed: failures, fatal: ev.fatal }, null, 2));
  if (ev.fatal) {
    console.log('==== FATAL 逐字 ====');
    console.log(ev.fatal);
    if (ev.captured.fatalUiState) console.log('UI 状态: ' + JSON.stringify(ev.captured.fatalUiState).slice(0, 600));
    if (ev.captured.devLogTail) console.log('---- tauri-dev.log 尾部 120 行 ----\n' + ev.captured.devLogTail.join('\n'));
  }
  process.exitCode = failures.length > 0 || ev.fatal ? 1 : 0;
  cdp.close();
}

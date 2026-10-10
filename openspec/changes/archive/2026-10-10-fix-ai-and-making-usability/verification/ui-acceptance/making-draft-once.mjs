// making-draft-once.mjs — 单次真实制作请求（bounded）。
// 真实 Tauri 隔离实例（CDP 9225）制作页：切到「制作对话」→ 查看既有链路 → 点「开始新制作」
// → 等待会话建立与「链路现状」附言终态 → 在 #making-conversation-input 输入一次卡片请求
// → 点 #making-conversation-send → 分段观察最多 90s，确认是否出现可保存草稿。
// 不点击保存、不切换版本、不做全量验收；不读用户正文/配置/密钥；不改源代码。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'evidence-making');
mkdirSync(outDir, { recursive: true });

const REQUEST = [
  '请帮我起草一张「回应要求卡」，用在日常陪想里。',
  '这张卡要求：我每次说完一句，你先分清我是在问事实、问感受，还是只想把思路摊开；如果我只给了片段，你先把片段里能确定的事实和不确定的猜测分开摆出来，再问我缺哪一块。',
  '回答时你只给有依据的观察、问题和可能走向，不替我判断这个故事好不好，也不要替我把内容写进文档。',
  '【首】先把我的原话里能确定的事实与拿不准的猜测分开摆出来，标出你依据的是哪几个词。',
  '【中】再围绕我给的这段材料递两三个具体问题，问题要贴着我用过的词句，不要泛泛而谈；如果看到几种可能的方向，就并列写清各自依据，不要只挑一个替我决定。',
  '【尾】最后收一句我接下来可以自己动手做的小事，把结论留给我。',
  '整段用大白话，不用术语。',
  '触发描述写成两行各约四十字：什么时候用这张卡，什么时候不要用。',
  '先一句话告诉我你对这张卡的理解，再给出标记块草稿。',
].join('\n');

const cdp = await connect(Number(process.argv[2] ?? 9225));
const log = [];
const ev = {
  started: new Date().toISOString(),
  target: cdp.target,
  request: REQUEST,
  requestLength: REQUEST.length,
  stages: [], samples: [], screenshots: [], consoleErrors: [],
};
const T0 = Date.now();
const mark = (name, data) => { log.push(`[+${((Date.now() - T0) / 1000).toFixed(1)}s] ${name}`); ev.stages.push({ name, t: Date.now() - T0, data }); };
const shot = async (n) => { const f = join(outDir, `${n}.png`); await cdp.screenshot(f); ev.screenshots.push(f); return f; };

// 采集制作对话区状态（只读结构；消息只取长度与状态，草稿面板取结构）。
const SNAP = `(() => {
  const b = id => document.getElementById(id);
  const R = e => { if(!e) return null; const r=e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  const msg = m => ({ role: m.className.replace('making-msg making-msg-',''), status: (m.querySelector('.making-msg-status')?.textContent||'').trim(), len: (m.querySelector('.making-msg-text')?.textContent||'').length });
  return {
    makingPageVisible: !b('making-page')?.classList.contains('hidden'),
    chatViewActive: b('making-view-chat-btn')?.classList.contains('active'),
    object: b('making-conversation-object')?.textContent ?? null,
    inputDisabled: b('making-conversation-input')?.disabled,
    inputRect: R(b('making-conversation-input')),
    sendDisabled: b('making-conversation-send')?.disabled,
    stopHidden: b('making-conversation-stop')?.hidden,
    notice: { hidden: b('making-session-notice')?.classList.contains('hidden'), text: b('making-session-notice')?.textContent ?? '' },
    messages: [...document.querySelectorAll('#making-session-messages .making-msg')].map(msg),
    draftPanels: [...document.querySelectorAll('.making-draft-panel')].map(p => ({
      turnIndex: p.dataset.draftTurnIndex,
      heading: p.querySelector('.making-draft-heading')?.textContent ?? '',
      cards: [...p.querySelectorAll('.making-draft-card')].map(c => ({
        typeBadge: c.querySelector('.making-draft-type')?.textContent ?? '',
        title: (c.querySelector('.making-draft-card .making-draft-label')?.parentElement?.textContent||'').slice(0,60),
        bodyLen: (c.querySelector('.making-draft-body')?.textContent||'').length,
        bodyHasBegin: (c.querySelector('.making-draft-body')?.textContent||'').includes('【首】'),
        bodyHasMid: (c.querySelector('.making-draft-body')?.textContent||'').includes('【中】'),
        bodyHasEnd: (c.querySelector('.making-draft-body')?.textContent||'').includes('【尾】'),
      })),
      saveBtn: p.querySelector('.making-draft-actions .making-mini-btn.primary')?.textContent.trim() ?? null,
      trialBtn: [...p.querySelectorAll('.making-draft-actions button')].map(x => ({ t: x.textContent.trim(), disabled: x.disabled })),
    })),
    recentVisible: !!(b('making-conversation-recent') && !b('making-conversation-recent').classList.contains('hidden') && b('making-conversation-recent').getBoundingClientRect().width>0),
  };
})()`;

try {
  // 0) 确认在制作页并切到「制作对话」标签
  await cdp.evaluate(`document.querySelector('#tab-making')?.click()`); await cdp.pause(300);
  await cdp.evaluate(`document.querySelector('#making-view-chat-btn')?.click()`); await cdp.pause(500);
  mark('chat-view', await cdp.evaluate(SNAP));
  await shot('making-draft-00-chat-view');

  // 1) 查看既有链路（只查看，不切换制作对象/全局启用）
  await cdp.evaluate(`document.querySelector('#making-chain-list .making-chain-row')?.click()`);
  await cdp.pause(500);
  mark('chain-viewed', await cdp.evaluate(`(() => ({ inspectorTitle: document.getElementById('making-inspector-title')?.textContent ?? '', rows: [...document.querySelectorAll('#making-chain-list .making-chain-row')].map(r=>({id:r.dataset.chainId, selected:r.classList.contains('selected'), text:r.textContent.trim().slice(0,40)})) }))()`));

  // 2) 点「开始新制作」→ 会话建立 +「链路现状」附言自动发送
  await cdp.click('#making-conversation-start-btn');
  mark('start-clicked', await cdp.evaluate(SNAP));

  // 3) 等待会话建立且「链路现状」附言终态（生成中结束）
  const preDeadline = Date.now() + 150000;
  let preLast = '';
  let preDone = false;
  while (Date.now() < preDeadline) {
    const s = await cdp.evaluate(SNAP);
    const sig = JSON.stringify({ m: s.messages, d: s.draftPanels, n: s.notice, i: s.inputDisabled });
    if (sig !== preLast) { ev.samples.push({ phase: 'preamble', t: Date.now() - T0, ...s }); preLast = sig; log.push(`[+${((Date.now() - T0) / 1000).toFixed(1)}s] preamble change msgs=${s.messages.length} inputDisabled=${s.inputDisabled} stopHidden=${s.stopHidden}`); }
    // 终态：输入可用（会话空闲）或最后一条助手轮不再 pending
    const last = s.messages[s.messages.length - 1];
    if (!s.inputDisabled && s.messages.length >= 2 && last && last.role === 'assistant' && last.status !== '生成中…') { preDone = true; ev.preambleSnapshot = s; break; }
    // 失败也要停：出现 error notice 且不再生成
    if (!s.inputDisabled && s.notice && !s.notice.hidden && /失败|错误/.test(s.notice.text)) { preDone = true; ev.preambleSnapshot = s; break; }
    await cdp.pause(2000);
  }
  await shot('making-draft-01-session-start');
  mark('preamble-step', { preDone, snapshot: ev.preambleSnapshot ?? null });

  if (!ev.preambleSnapshot) {
    ev.result = { status: 'preamble-not-terminal', detail: '「链路现状」附言在 150s 内未到终态，未发送卡片请求' };
    throw new Error('preamble not terminal');
  }
  if (ev.preambleSnapshot.inputDisabled) {
    ev.result = { status: 'input-unavailable', detail: '附言终态但输入仍不可用' };
    throw new Error('input unavailable');
  }

  // 4) 输入一次卡片请求并发送
  await cdp.fillText('#making-conversation-input', REQUEST);
  ev.typed = await cdp.evaluate(`(() => { const i=document.getElementById('making-conversation-input'); return { len:i.value.length, sendDisabled:document.getElementById('making-conversation-send').disabled }; })()`);
  mark('request-typed', ev.typed);
  await shot('making-draft-02-request-typed');

  const sendT = Date.now();
  await cdp.click('#making-conversation-send');
  mark('request-sent', { at: sendT - T0, snap: await cdp.evaluate(SNAP) });

  // 5) 分段观察最多 90s
  const obsDeadline = Date.now() + 90000;
  let obsLast = '';
  while (Date.now() < obsDeadline) {
    const s = await cdp.evaluate(SNAP);
    const sig = JSON.stringify({ m: s.messages, d: s.draftPanels, n: s.notice, i: s.inputDisabled });
    if (sig !== obsLast) { ev.samples.push({ phase: 'request', t: Date.now() - T0, dt: Date.now() - sendT, ...s }); obsLast = sig; log.push(`[+${((Date.now() - sendT) / 1000).toFixed(1)}s] request change msgs=${s.messages.length} drafts=${s.draftPanels.length} inputDisabled=${s.inputDisabled}`); }
    // 终态：出现草稿面板，或助手轮结束（输入可用且最后助手轮非 pending），或显式失败
    const last = s.messages[s.messages.length - 1];
    if (s.draftPanels.length > 0 && !s.inputDisabled) { ev.requestSnapshot = s; break; }
    if (!s.inputDisabled && last && last.role === 'assistant' && last.status !== '生成中…') { ev.requestSnapshot = s; break; }
    await cdp.pause(2000);
  }
  if (!ev.requestSnapshot) {
    ev.requestSnapshot = await cdp.evaluate(SNAP);
    ev.observationExpired = true;
  }
  ev.observationMs = Date.now() - sendT;
  await shot('making-draft-03-request-result');
  mark('request-observed', { observationMs: ev.observationMs, expired: !!ev.observationExpired, snapshot: ev.requestSnapshot });

  // 6) 若出现草稿，展开完整原文核对并截图（不点保存）
  const draftCount = ev.requestSnapshot.draftPanels.length;
  if (draftCount > 0) {
    // 打开确认对话框里的「展开完整原文核对」不触发；这里直接读取草稿正文全文（只读）
    ev.draftFull = await cdp.evaluate(`(() => [...document.querySelectorAll('.making-draft-panel .making-draft-card')].map(c => ({
      type: c.querySelector('.making-draft-type')?.textContent ?? '',
      title: c.querySelector('.making-draft-line')?.querySelector('span:last-child')?.textContent ?? '',
      whenToUse: c.querySelectorAll('.making-draft-line')[1]?.querySelector('span:last-child')?.textContent ?? '',
      whenNotToUse: c.querySelectorAll('.making-draft-line')[2]?.querySelector('span:last-child')?.textContent ?? '',
      body: c.querySelector('.making-draft-body')?.textContent ?? '',
    })))()`);
    // 可保存草稿的实际 selectors
    ev.draftSaveSelectors = await cdp.evaluate(`(() => {
      const panel = document.querySelector('.making-draft-panel');
      if (!panel) return null;
      const save = panel.querySelector('.making-draft-actions .making-mini-btn.primary');
      const detailBtn = null;
      return {
        panel: '.making-draft-panel',
        panelByTurn: panel.dataset.draftTurnIndex ? '.making-draft-panel[data-draft-turn-index="' + panel.dataset.draftTurnIndex + '"]' : null,
        card: '.making-draft-panel .making-draft-card',
        body: '.making-draft-panel .making-draft-card .making-draft-body',
        saveButton: '.making-draft-panel .making-draft-actions .making-mini-btn.primary',
        saveButtonText: save?.textContent.trim() ?? null,
        saveButtonDisabled: save?.disabled ?? null,
        trialButtons: [...panel.querySelectorAll('.making-draft-actions button')].map(x=>({ text:x.textContent.trim(), disabled:x.disabled, cls:x.className })),
      };
    })()`);
  }

  // 结果归类
  if (draftCount > 0) {
    ev.result = { status: 'draft-present', draftCount, saveButton: ev.draftSaveSelectors?.saveButtonText ?? null };
  } else {
    const last = ev.requestSnapshot.messages[ev.requestSnapshot.messages.length - 1];
    if (last && last.role === 'assistant' && last.status === '生成失败') ev.result = { status: 'generation-failed', note: ev.requestSnapshot.notice?.text ?? '' };
    else if (ev.observationExpired) ev.result = { status: 'still-generating-at-90s', note: '90s 内未出草稿也未到终态，如实记录当前事实，不强制停止' };
    else ev.result = { status: 'reply-without-draft', note: ev.requestSnapshot.notice?.text ?? '' };
  }
  ev.requestReplyText = await cdp.evaluate(`(() => { const msgs=[...document.querySelectorAll('#making-session-messages .making-msg-assistant .making-msg-text')]; return msgs.length? msgs[msgs.length-1].textContent : null; })()`);
  mark('result', ev.result);
} catch (error) {
  ev.fatal = String(error?.message ?? error);
  mark('fatal', ev.fatal);
} finally {
  ev.finished = new Date().toISOString();
  ev.log = log;
  ev.consoleErrors = cdp.consoleErrors;
  writeFileSync(join(outDir, 'making-draft-request.json'), JSON.stringify(ev, null, 2));
  const brief = {
    result: ev.result ?? null,
    fatal: ev.fatal ?? null,
    observationMs: ev.observationMs ?? null,
    observationExpired: ev.observationExpired ?? null,
    preambleDone: !!ev.preambleSnapshot,
    requestMsgCount: ev.requestSnapshot?.messages?.length ?? null,
    draftCount: ev.requestSnapshot?.draftPanels?.length ?? null,
    draftTypes: ev.draftFull?.map(d => d.type) ?? [],
    bodyLens: ev.draftFull?.map(d => d.body.length) ?? [],
    markers: ev.draftFull?.map(d => ({ begin: d.body.includes('【首】'), mid: d.body.includes('【中】'), end: d.body.includes('【尾】') })) ?? [],
    draftSaveSelectors: ev.draftSaveSelectors ?? null,
    consoleErrors: ev.consoleErrors.slice(0, 5),
    log,
  };
  console.log(JSON.stringify(brief, null, 2));
  cdp.close();
}

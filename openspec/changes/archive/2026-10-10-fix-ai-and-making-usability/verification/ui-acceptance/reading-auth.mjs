// reading-auth.mjs — tasks 4.4 真实补读授权端到端（bounded）。
// 在隔离项目（关注 Doc A=未命名文档）常规提问，明确请补读另一篇 Doc B=钟表铺，
// 触发真实 story-request-reading → pending 授权卡；观察等待授权状态、长正文滚顶/底固定可见可点、
// 切换讨论不串卡、回到所属讨论允许并恢复链路。最多 2 次请求，每次有界 180s。
// 完成判定读取真实 [data-role="conversation"]（不再只认不存在的 response）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'evidence-reading-auth');
mkdirSync(outDir, { recursive: true });
const PROJECT_NAME = 'CDP几何验收-隔离';
const Q = '请补读另一篇文档《钟表铺》的完整正文，把里面出现的地点、物件和细节逐条整理给我，并说明你读了哪些文档。';

const cdp = await connect(Number(process.argv[2] ?? 9225));
const ev = { started: new Date().toISOString(), target: cdp.target, question: Q, attempts: [], stages: [], screenshots: [], samples: [], consoleErrors: [] };
const T0 = Date.now();
const at = () => ((Date.now()-T0)/1000).toFixed(1);
const stage = (name, data) => { ev.stages.push({ name, t: Date.now()-T0, data }); };
const shot = async (n) => { const f = join(outDir, `${n}.png`); await cdp.screenshot(f); ev.screenshots.push(f); return f; };

const snapshot = () => cdp.evaluate(`(() => {
  const win=document.querySelector('.ai-window');
  const vis=e=>!!e&&e.getBoundingClientRect().width>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const txt=e=>(e?.innerText||'').replace(/\\s+/g,' ').trim();
  const card=win?.querySelector('[data-role="reading-request"]');
  const badge=win?.querySelector('[data-role="badge"]');
  const dot=win?.querySelector('[data-role="status-dot"]');
  const loading=win?.querySelector('[data-role="loading"]');
  const conv=win?.querySelector('[data-role="conversation"]');
  const err=win?.querySelector('[data-role="error-block"]');
  const cfg=win?.querySelector('[data-role="config-block"]');
  return {
    hasWindow: !!win,
    pending: vis(card),
    badgeText: txt(badge) || null, badgeClass: badge?.className ?? null,
    dotClass: dot?.className ?? null,
    loading: vis(loading), loadingText: txt(loading),
    conversation: vis(conv), conversationText: txt(conv).slice(0,800),
    error: vis(err), errorText: txt(win?.querySelector('[data-role="error-message"]')).slice(0,300),
    config: vis(cfg),
    allow: vis(win?.querySelector('[data-role="reading-allow"]')),
    deny: vis(win?.querySelector('[data-role="reading-deny"]')),
  };
})()`);
const settled = s => !s.pending && !s.loading && (s.conversationText.length > 0 || s.error || s.config);

async function pollUntil(deadlineMs, stopFn, label) {
  const deadline = Date.now() + deadlineMs;
  let last = '';
  while (Date.now() < deadline) {
    const s = await snapshot();
    const sig = JSON.stringify(s);
    if (sig !== last) { ev.samples.push({ t: Date.now()-T0, label, ...s }); last = sig; }
    if (stopFn(s)) return s;
    await cdp.pause(1500);
  }
  return await snapshot();
}

async function startRequest(question) {
  // 先经「讨论」列表「新建对话」开一个空讨论（保证直接提问入口可用），再输入提交。
  await cdp.evaluate(`document.querySelector('#ai-conversation-list-toggle')?.click()`);
  await cdp.pause(300);
  await cdp.evaluate(`document.querySelector('#ai-list-new-conversation')?.click()`);
  await cdp.pause(500);
  const fresh = await cdp.evaluate(`(() => { const win=document.querySelector('.ai-window'); const conv=win?.querySelector('[data-role="conversation"]'); return { hasWindow: !!win, convText: (conv?.innerText||'').trim().length }; })()`);
  await cdp.evaluate(`(() => { const ta=document.querySelector('.ai-window [data-role="direct-question-input"]'); if(!ta) return; ta.value=''; ta.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await cdp.pause(150);
  await cdp.evaluate(`(() => { const ta=document.querySelector('.ai-window [data-role="direct-question-input"]'); ta.value=${JSON.stringify(question)}; ta.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await cdp.pause(400);
  const disabled = await cdp.evaluate(`document.querySelector('.ai-window [data-role="direct-question-send"]')?.disabled`);
  if (disabled) return { submitted: false, reason: 'send disabled', fresh };
  await cdp.evaluate(`document.querySelector('.ai-window [data-role="direct-question-send"]')?.click()`);
  return { submitted: true, fresh };
}

try {
  // 准备：项目 + 写作页
  const welcome = await cdp.evaluate(`!document.querySelector('#welcome-page')?.classList.contains('hidden')`);
  if (welcome) {
    await cdp.evaluate(`(() => { const it=[...document.querySelectorAll('.recent-work-item')].find(e=>(e.querySelector('.recent-work-name')?.textContent||'').includes(${JSON.stringify(PROJECT_NAME)})); it?.click(); })()`);
    for (let i=0;i<60;i++){ if (await cdp.evaluate(`!document.querySelector('#editor-page')?.classList.contains('hidden')`)) break; await cdp.pause(200); }
  }
  await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`); await cdp.pause(250);
  if (!(await cdp.evaluate(`(() => { const d=document.querySelector('#ai-dock'); return !!d && !d.classList.contains('hidden'); })()`))) { await cdp.click('#btn-toggle-ai'); await cdp.pause(300); }
  stage('ready', await cdp.evaluate(`({ current: document.querySelector('#current-document-name')?.textContent ?? '', pm: (document.querySelector('#editor-textarea .ProseMirror')?.innerText||'').slice(0,80) })`));

  // 尝试 1（最多 2 次）
  const sub = await startRequest(Q);
  stage('request-1', sub);
  let s = await pollUntil(180000, (x) => x.pending || settled(x), 'attempt1');
  stage('attempt1-outcome', { t: Date.now()-T0, pending: s.pending, settled: settled(s), badge: s.badgeText, loading: s.loading, conv: s.conversationText.slice(0,200), error: s.errorText });
  await shot('attempt1-outcome');

  if (!s.pending) {
    ev.result = { status: settled(s) ? 'no-reading-request-answered' : 'no-reading-request-timeout', detail: s };
    stage('no-pending', { attempt: 1 });
  } else {
    // ==== pending 阶段观察 ====
    stage('pending-status', { badgeText: s.badgeText, badgeClass: s.badgeClass, dotClass: s.dotClass, loading: s.loading, loadingText: s.loadingText, allow: s.allow, deny: s.deny, reason: await cdp.evaluate(`document.querySelector('.ai-window [data-role="reading-request-reason"]')?.textContent`), title: await cdp.evaluate(`document.querySelector('.ai-window [data-role="reading-request-title"]')?.textContent`) });
    await shot('pending-card');

    // 长正文滚顶/滚底：卡固定可见可点
    await cdp.evaluate(`(() => { const b=document.querySelector('.ai-window [data-role="body"]'); const f=document.getElementById('__cdp_filler2'); if(b && !f){ const d=document.createElement('div'); d.id='__cdp_filler2'; for(let i=0;i<40;i++){const p=document.createElement('p');p.textContent='CDP 长正文 fixture 段落 '+i+'：制造正文滚动，验证授权卡在滚动区之外固定可见。';d.append(p);} b.prepend(d); } })()`);
    await cdp.pause(250);
    const readCard = () => cdp.evaluate(`(() => { const card=document.querySelector('.ai-window [data-role="reading-request"]'); const allow=document.querySelector('.ai-window [data-role="reading-allow"]'); const body=document.querySelector('.ai-window [data-role="body"]'); const R=e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};}; const ar=allow?.getBoundingClientRect(); const hit=ar?document.elementFromPoint(ar.x+ar.width/2,ar.y+ar.height/2):null; const inBody=!!(card&&body&&body.contains(card)); return { cardRect:R(card), allowRect:R(allow), bodyScrollTop:Math.round(body.scrollTop), scrollable: body.scrollHeight>body.clientHeight+1, allowHit: !!allow&&hit===allow, cardInsideBody: inBody }; })()`);
    await cdp.evaluate(`document.querySelector('.ai-window [data-role="body"]').scrollTop=0`); await cdp.pause(200);
    const top = await readCard();
    await cdp.evaluate(`(() => { const b=document.querySelector('.ai-window [data-role="body"]'); b.scrollTop=b.scrollHeight; })()`); await cdp.pause(200);
    const bottom = await readCard();
    stage('scroll-fixed', { top, bottom });
    await shot('pending-scroll-bottom');

    // 切换另一讨论 → 不串卡
    const pendingTitle = await cdp.evaluate(`document.querySelector('.ai-window [data-role="title"]')?.textContent ?? null`);
    await cdp.evaluate(`document.querySelector('#ai-conversation-list-toggle')?.click()`); await cdp.pause(300);
    const switched = await cdp.evaluate(`(() => { const rows=[...document.querySelectorAll('.ai-cl-row')]; const other=rows.find(r=>!r.classList.contains('active')); if(!other) return {ok:false, rows: rows.length}; other.click(); return {ok:true, rows: rows.length}; })()`);
    await cdp.pause(600);
    const otherState = await snapshot();
    stage('switch-away', { switched, otherPending: otherState.pending, otherHasWindow: otherState.hasWindow, otherTitle: await cdp.evaluate(`document.querySelector('.ai-window [data-role="title"]')?.textContent ?? null`) });
    await shot('switch-away');

    // 回到所属讨论
    await cdp.evaluate(`document.querySelector('#ai-conversation-list-toggle')?.click()`); await cdp.pause(300);
    await cdp.evaluate(`(() => { const rows=[...document.querySelectorAll('.ai-cl-row')]; const target=rows.find(r=>!r.classList.contains('active')); target?.click(); })()`);
    await cdp.pause(700);
    const back = await snapshot();
    stage('switch-back', { pending: back.pending, title: await cdp.evaluate(`document.querySelector('.ai-window [data-role="title"]')?.textContent ?? null`) });

    // 允许（真实恢复链路）
    if (back.pending) {
      await cdp.evaluate(`document.querySelector('.ai-window [data-role="reading-allow"]')?.click()`);
      stage('allow-clicked', { t: Date.now()-T0 });
      await shot('after-allow');
      const done = await pollUntil(180000, (x) => settled(x), 'after-allow');
      const replyHasMarker = /钟表铺|蓝色乌鸦|凌晨三点七分/.test(done.conversationText);
      stage('after-allow-outcome', { settled: settled(done), loading: done.loading, pending: done.pending, error: done.errorText, replyHasMarker, conv: done.conversationText.slice(0,400) });
      await shot('after-allow-reply');
      ev.result = { status: settled(done) ? 'granted-recovered' : 'granted-timeout', replyHasMarker, conv: done.conversationText.slice(0,500), error: done.errorText };
    } else {
      ev.result = { status: 'pending-lost-after-switch', back };
    }
  }
  ev.finished = new Date().toISOString();
} catch (error) {
  ev.fatal = String(error?.message ?? error);
  stage('fatal', ev.fatal);
} finally {
  ev.consoleErrors = cdp.consoleErrors;
  ev.elapsedMs = Date.now()-T0;
  writeFileSync(join(outDir, 'reading-auth.json'), JSON.stringify(ev, null, 2));
  console.log(JSON.stringify({ result: ev.result ?? null, fatal: ev.fatal ?? null, elapsedMs: ev.elapsedMs, stages: ev.stages.map(s=>({name:s.name, t:s.t, data:s.data})), sampleCount: ev.samples.length }, null, 2));
  cdp.close();
}

// reading-auth-pending.mjs — 对**当前已在待决的真实补读授权**做 4.4 观察（不再发新请求）：
// 等待授权状态（非正在思考）、长正文滚顶/滚底卡固定可见可点、切换讨论不串卡、回到所属讨论允许→真实恢复链路。
// 完成判定读真实 conversation + 状态点（不再只认 response）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'evidence-reading-auth');
mkdirSync(outDir, { recursive: true });

const cdp = await connect(Number(process.argv[2] ?? 9225));
const ev = { started: new Date().toISOString(), target: cdp.target, stages: [], samples: [], screenshots: [], consoleErrors: [] };
const T0 = Date.now();
const at = () => Date.now()-T0;
const stage = (name, data) => ev.stages.push({ name, t: at(), data });
const shot = async (n) => { const f = join(outDir, `${n}.png`); await cdp.screenshot(f); ev.screenshots.push(f); return f; };

const snapshot = () => cdp.evaluate(`(() => {
  const w=document.querySelector('.ai-window');
  const vis=e=>!!e&&e.getBoundingClientRect().width>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const t=e=>(e?.innerText||'').replace(/\\s+/g,' ').trim();
  const card=w?.querySelector('[data-role="reading-request"]');
  const body=w?.querySelector('[data-role="body"]');
  const allow=w?.querySelector('[data-role="reading-allow"]');
  const ar=allow?.getBoundingClientRect();
  const hit=ar?document.elementFromPoint(ar.x+ar.width/2, ar.y+ar.height/2):null;
  const R=e=>{ if(!e) return null; const r=e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    title: t(w?.querySelector('[data-role="title"]')),
    badge: t(w?.querySelector('[data-role="badge"]')),
    dot: w?.querySelector('[data-role="status-dot"]')?.className ?? null,
    pending: vis(card), pendingRect: R(card), pendingInsideBody: !!(card && body && body.contains(card)),
    loading: vis(w?.querySelector('[data-role="loading"]')), loadingText: t(w?.querySelector('[data-role="loading"]')),
    allow: vis(allow), deny: vis(w?.querySelector('[data-role="reading-deny"]')), allowHit: !!allow && hit===allow, allowRect: R(allow),
    bodyScroll: body ? {top:Math.round(body.scrollTop), sh:body.scrollHeight, ch:body.clientHeight, scrollable: body.scrollHeight>body.clientHeight+1} : null,
    conv: t(w?.querySelector('[data-role="conversation"]')).slice(0,500),
    error: vis(w?.querySelector('[data-role="error-block"]')), errorText: t(w?.querySelector('[data-role="error-message"]')).slice(0,300),
    config: vis(w?.querySelector('[data-role="config-block"]')),
  };
})()`);
const settled = s => !s.pending && !s.loading && (s.dot?.includes('is-done') || s.dot?.includes('is-failed') || s.dot?.includes('is-stopped') || s.error || s.config);

try {
  const start = await snapshot();
  stage('start-pending', { pending: start.pending, badge: start.badge, dot: start.dot, loading: start.loading, loadingText: start.loadingText, reason: await cdp.evaluate(`document.querySelector('.ai-window [data-role="reading-request-reason"]')?.textContent`) });
  if (!start.pending) { ev.result = { status: 'not-pending', start }; throw new Error('no pending at start'); }
  await shot('pending-card');

  // 长正文滚顶/滚底：卡固定可见可点（注入长正文制造滚动，fixture 标注）
  await cdp.evaluate(`(() => { const b=document.querySelector('.ai-window [data-role="body"]'); const f=document.getElementById('__cdp_filler3'); if(b && !f){ const d=document.createElement('div'); d.id='__cdp_filler3'; for(let i=0;i<40;i++){const p=document.createElement('p');p.textContent='CDP 长正文 fixture 段落 '+i+'：制造正文滚动，验证授权卡在滚动区之外固定可见。';d.append(p);} b.prepend(d); } })()`);
  await cdp.pause(250);
  await cdp.evaluate(`document.querySelector('.ai-window [data-role="body"]').scrollTop=0`); await cdp.pause(200);
  const top = await snapshot();
  await cdp.evaluate(`(() => { const b=document.querySelector('.ai-window [data-role="body"]'); b.scrollTop=b.scrollHeight; })()`); await cdp.pause(200);
  const bottom = await snapshot();
  stage('scroll-fixed', { top: { scroll: top.bodyScroll, cardRect: top.pendingRect, allowHit: top.allowHit, visible: top.pending }, bottom: { scroll: bottom.bodyScroll, cardRect: bottom.pendingRect, allowHit: bottom.allowHit, visible: bottom.pending }, cardInsideBody: top.pendingInsideBody });
  await shot('pending-scroll-bottom');

  // 切换另一讨论 → 不串卡
  await cdp.evaluate(`document.querySelector('#ai-conversation-list-toggle')?.click()`); await cdp.pause(300);
  const switched = await cdp.evaluate(`(() => { const rows=[...document.querySelectorAll('.ai-cl-row')]; const other=rows.find(r=>!r.classList.contains('active')); if(!other) return {ok:false, rows:rows.length}; other.click(); return {ok:true, rows:rows.length}; })()`);
  await cdp.pause(700);
  const away = await snapshot();
  stage('switch-away', { switched, title: away.title, pending: away.pending, badge: away.badge });
  await shot('switch-away');

  // 回到所属讨论
  await cdp.evaluate(`document.querySelector('#ai-conversation-list-toggle')?.click()`); await cdp.pause(300);
  await cdp.evaluate(`(() => { const rows=[...document.querySelectorAll('.ai-cl-row')]; const target=rows.find(r=>!r.classList.contains('active')); target?.click(); })()`);
  await cdp.pause(800);
  const back = await snapshot();
  stage('switch-back', { title: back.title, pending: back.pending, badge: back.badge, dot: back.dot });
  await shot('switch-back');

  if (!back.pending) { ev.result = { status: 'pending-lost-after-switch', back }; throw new Error('pending lost'); }

  // 允许 → 真实恢复链路
  await cdp.evaluate(`document.querySelector('.ai-window [data-role="reading-allow"]')?.click()`);
  stage('allow-clicked', { t: at() });
  await shot('after-allow');
  const deadline = Date.now() + 180000;
  let last=''; let final = await snapshot();
  while (Date.now() < deadline) {
    const s = await snapshot();
    const sig = JSON.stringify({pending:s.pending, badge:s.badge, dot:s.dot, loading:s.loading, len:s.conv.length, err:s.errorText});
    if (sig !== last) { ev.samples.push({ t: at(), ...s }); last = sig; }
    final = s;
    if (settled(s)) break;
    await cdp.pause(1500);
  }
  await shot('after-allow-reply');
  const marker = /钟表铺|蓝色乌鸦|凌晨三点七分/.test(final.conv);
  stage('after-allow-outcome', { settled: settled(final), pending: final.pending, loading: final.loading, dot: final.dot, badge: final.badge, error: final.errorText, replyHasMarker: marker, conv: final.conv.slice(0,500) });
  ev.result = { status: settled(final) ? 'granted-recovered' : 'granted-timeout', replyHasMarker: marker, conv: final.conv.slice(0,500), error: final.errorText };
} catch (error) {
  ev.fatal = String(error?.message ?? error);
  stage('fatal', ev.fatal);
} finally {
  ev.consoleErrors = cdp.consoleErrors;
  ev.elapsedMs = at();
  writeFileSync(join(outDir, 'reading-auth-pending.json'), JSON.stringify(ev, null, 2));
  console.log(JSON.stringify({ result: ev.result ?? null, fatal: ev.fatal ?? null, elapsedMs: ev.elapsedMs, stages: ev.stages }, null, 2));
  cdp.close();
}

// summon-once.mjs — 单次真实选区及时召唤（bounded）。
// 在隔离 fixture 项目（CDP几何验收-隔离）里用「用户式」编辑动作写入跨段落、含引号/反斜杠/
// inline mark 的文本，形成跨段落选区，点击选区旁「AI」触发真实召唤；观察真实模型首轮回复或具体错误。
// 不写正式用户正文；只用隔离项目；不 AI 写文档。上限 180s 单次观察，分段采样。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'evidence-summon');
mkdirSync(outDir, { recursive: true });
const PROJECT_NAME = 'CDP几何验收-隔离';
const P1 = '沈一苇说："信里写着 C:\\旧站\\第七封。"';
const P2 = '她把信折好，放回抽屉，没有回头。';
const BOLD_WORD = '第七封';

const cdp = await connect(Number(process.argv[2] ?? 9225));
const log = [];
const ev = { started: new Date().toISOString(), target: cdp.target, fixture: { p1: P1, p2: P2, boldWord: BOLD_WORD, selectionStartMarker: '信里', selectionEndMarker: '放回' }, stages: [], samples: [], screenshots: [], consoleErrors: [] };
const T0 = Date.now();
const mark = (name, data) => { log.push(`[+${((Date.now()-T0)/1000).toFixed(1)}s] ${name}`); ev.stages.push({ name, t: Date.now()-T0, data }); };
const shot = async (n) => { const f = join(outDir, `${n}.png`); await cdp.screenshot(f); ev.screenshots.push(f); return f; };

try {
  // 1) 打开隔离项目
  const welcome = await cdp.evaluate(`!document.querySelector('#welcome-page')?.classList.contains('hidden')`);
  if (welcome) {
    await cdp.evaluate(`(() => { const it=[...document.querySelectorAll('.recent-work-item')].find(e=>(e.querySelector('.recent-work-name')?.textContent||'').includes(${JSON.stringify(PROJECT_NAME)})); it?.click(); })()`);
    for (let i=0;i<60;i++){ if (await cdp.evaluate(`!document.querySelector('#editor-page')?.classList.contains('hidden')`)) break; await cdp.pause(200); }
    await cdp.pause(400);
  }
  await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`); await cdp.pause(250);
  mark('project-open', await cdp.evaluate(`({ current: document.querySelector('#current-project-name')?.textContent ?? '', editor: !document.querySelector('#editor-page')?.classList.contains('hidden') })`));

  // 2) 用户式输入文本（清空后输入两段）
  await cdp.evaluate(`(() => { const pm=document.querySelector('#editor-textarea .ProseMirror'); pm.focus(); })()`);
  await cdp.pause(150);
  // 清空：全选删除（用户式 Ctrl+A Delete）
  await cdp.send('Input.dispatchKeyEvent', { type:'keyDown', key:'a', code:'KeyA', windowsVirtualKeyCode:65, modifiers:2 });
  await cdp.send('Input.dispatchKeyEvent', { type:'keyUp', key:'a', code:'KeyA', windowsVirtualKeyCode:65, modifiers:2 });
  await cdp.key('Delete','Delete',46);
  await cdp.pause(150);
  await cdp.insertText(P1);
  await cdp.key('Enter','Enter',13);
  await cdp.insertText(P2);
  await cdp.pause(250);
  ev.afterType = await cdp.evaluate(`({ pmText: (document.querySelector('#editor-textarea .ProseMirror')?.innerText||'').slice(0,200), html: (document.querySelector('#editor-textarea .ProseMirror')?.innerHTML||'').slice(0,400) })`);
  mark('typed', ev.afterType);

  // 3) 给 BOLD_WORD 加 inline mark（用户式：选中后点工具栏 B）
  const bolded = await cdp.evaluate(`(() => {
    const pm=document.querySelector('#editor-textarea .ProseMirror'); if(!pm) return {ok:false};
    const w=document.createTreeWalker(pm, NodeFilter.SHOW_TEXT); let n, target=null;
    while(n=w.nextNode()){ if(n.textContent.includes(${JSON.stringify(BOLD_WORD)})){ target=n; break; } }
    if(!target) return {ok:false, reason:'word not found'};
    const i=target.textContent.indexOf(${JSON.stringify(BOLD_WORD)});
    const r=document.createRange(); r.setStart(target,i); r.setEnd(target,i+${BOLD_WORD.length});
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); pm.focus();
    return {ok:true};
  })()`);
  await cdp.pause(150);
  if (bolded.ok) { await cdp.click('#btn-bold'); await cdp.pause(250); }
  ev.afterBold = await cdp.evaluate(`({ html: (document.querySelector('#editor-textarea .ProseMirror')?.innerHTML||'').slice(0,500) })`);
  mark('bold', { bolded, htmlHasStrong: /<strong>|mark-bold|font-weight/i.test(ev.afterBold.html) });

  // 4) 形成跨段落选区（从「信里」到「放回」后）
  const selInfo = await cdp.evaluate(`(() => {
    const pm=document.querySelector('#editor-textarea .ProseMirror'); if(!pm) return {ok:false};
    const w=document.createTreeWalker(pm, NodeFilter.SHOW_TEXT); let n; const nodes=[];
    while(n=w.nextNode()) nodes.push(n);
    const startNode=nodes.find(x=>x.textContent.includes('信里'));
    const endNode=nodes.find(x=>x.textContent.includes('放回'));
    if(!startNode||!endNode) return {ok:false, reason:'markers not found', texts: nodes.map(x=>x.textContent)};
    const r=document.createRange();
    r.setStart(startNode, startNode.textContent.indexOf('信里'));
    r.setEnd(endNode, endNode.textContent.indexOf('放回')+2);
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); pm.focus();
    return {ok:true, selected: s.toString()};
  })()`);
  // 触发 selection-entry 更新：派发 mouseup/select
  await cdp.evaluate(`(() => { const pm=document.querySelector('#editor-textarea .ProseMirror'); pm?.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); pm?.dispatchEvent(new Event('select',{bubbles:true})); })()`);
  await cdp.pause(300);
  ev.selectionEntry = await cdp.evaluate(`(() => { const e=document.querySelector('#ai-selection-entry'); const t=document.querySelector('#ai-selection-entry-trigger'); const vis=!!e && !e.classList.contains('hidden') && e.getBoundingClientRect().width>0; const r=t?.getBoundingClientRect(); return { visible: vis, triggerRect: r?{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}:null }; })()`);
  mark('selection', { selInfo, entry: ev.selectionEntry });
  await shot('summon-selection');

  if (!ev.selectionEntry.visible) {
    ev.result = { status: 'entry-not-visible', detail: '选区形成后召唤入口未显示，未点击' };
    throw new Error('selection entry not visible');
  }

  // 5) 点击「AI」召唤
  const clickT = Date.now();
  await cdp.evaluate(`document.querySelector('#ai-selection-entry-trigger')?.click()`);
  mark('summon-clicked', { at: Date.now()-T0 });

  // 6) 观察最多 180s
  const deadline = Date.now() + 180000;
  let last = '';
  while (Date.now() < deadline) {
    const s = await cdp.evaluate(`(() => {
      const dock=document.querySelector('#ai-dock');
      const win=document.querySelector('.ai-window');
      const body=document.querySelector('.ai-window [data-role="body"]');
      const vis=e=>!!e&&e.getBoundingClientRect().width>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
      const txt=e=>(e?.innerText||'').replace(/\\s+/g,' ').trim();
      const load=win?.querySelector('[data-role="loading"]');
      const resp=win?.querySelector('[data-role="response"]');
      const errblk=win?.querySelector('[data-role="error-block"]');
      const errMsg=win?.querySelector('[data-role="error-message"]');
      const cfg=win?.querySelector('[data-role="config-block"]');
      const conv=win?.querySelector('[data-role="conversation"]');
      return {
        dockOpen: !!dock && !dock.classList.contains('hidden'),
        hasWindow: !!win, windowClass: win?.className ?? null,
        loading: vis(load), loadingText: txt(load),
        response: vis(resp), responseText: txt(resp).slice(0,600),
        error: vis(errblk), errorText: txt(errMsg).slice(0,400),
        config: vis(cfg) || vis(win?.querySelector('[data-role="direct-question-config"]')),
        conversation: vis(conv), bodyText: txt(body).slice(0,600),
      };
    })()`);
    const sig = JSON.stringify(s);
    if (sig !== last) { ev.samples.push({ t: Date.now()-T0, ...s }); last = sig; log.push(`[+${((Date.now()-T0)/1000).toFixed(1)}s] state change: loading=${s.loading} response=${s.response} error=${s.error} config=${s.config}`); }
    if (s.response || s.error || s.config) break;
    await cdp.pause(2000);
  }
  await shot('summon-result');
  ev.observationMs = Date.now()-clickT;
  const final = ev.samples[ev.samples.length-1] ?? null;
  if (final?.response) ev.result = { status: 'reply', text: final.responseText };
  else if (final?.error) ev.result = { status: 'error', text: final.errorText };
  else if (final?.config) ev.result = { status: 'configuration-required' };
  else if (final?.loading) ev.result = { status: 'still-loading-at-timeout', loadingText: final.loadingText };
  else ev.result = { status: 'unknown', final };
  mark('result', ev.result);
} catch (error) {
  ev.fatal = String(error?.message ?? error);
  mark('fatal', ev.fatal);
} finally {
  ev.finished = new Date().toISOString();
  ev.log = log;
  ev.consoleErrors = cdp.consoleErrors;
  writeFileSync(join(outDir, 'single-real-summon.json'), JSON.stringify(ev, null, 2));
  console.log(JSON.stringify({ result: ev.result ?? null, fatal: ev.fatal ?? null, observationMs: ev.observationMs ?? null, selectionEntry: ev.selectionEntry ?? null, afterType: ev.afterType ?? null, boldHasStrong: ev.afterBold ? /<strong>|mark-bold/i.test(ev.afterBold.html) : null, samples: ev.samples.map(s=>({t:s.t,loading:s.loading,response:s.response,error:s.error,config:s.config})), log }, null, 2));
  cdp.close();
}

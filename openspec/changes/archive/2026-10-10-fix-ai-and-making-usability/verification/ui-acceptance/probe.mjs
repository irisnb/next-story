// probe.mjs — 只读侦察：当前页面/项目/AI 面板/讨论状态。不改任何数据。
import { connect } from './cdp-client.mjs';

const cdp = await connect(Number(process.argv[2] ?? 9225));
const state = await cdp.evaluate(`(() => {
  const visible = e => !!e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden';
  const rect = e => { if(!e) return null; const r = e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    href: location.href,
    viewport: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
    pages: [...document.querySelectorAll('#welcome-page,#editor-page,.module-page')].filter(visible).map(e => e.id),
    currentProject: document.querySelector('#current-project-name')?.textContent ?? null,
    aiDock: { exists: !!document.querySelector('#ai-dock'), visible: visible(document.querySelector('#ai-dock')), rect: rect(document.querySelector('#ai-dock')) },
    aiWindowHeads: [...document.querySelectorAll('.ai-window-head')].map(e => ({ visible: visible(e), rect: rect(e), text: e.innerText.replace(/\\s+/g,' ').slice(0,120) })),
    aiWindows: document.querySelectorAll('.ai-window').length,
    conversationList: { exists: !!document.querySelector('.ai-conversation-list'), visible: visible(document.querySelector('.ai-conversation-list')), rect: rect(document.querySelector('.ai-conversation-list')) },
    listRows: document.querySelectorAll('.ai-cl-row').length,
    tabs: [...document.querySelectorAll('#tab-writing,#tab-making,#tab-files,#tab-settings')].map(e => ({ id: e.id, visible: visible(e), active: e.classList.contains('active')||e.getAttribute('aria-selected')==='true' })),
    bodyTextHead: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0, 400),
  };
})()`);
console.log(JSON.stringify(state, null, 2));
cdp.close();

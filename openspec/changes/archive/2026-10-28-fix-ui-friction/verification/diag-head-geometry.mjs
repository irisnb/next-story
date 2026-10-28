// diag-head-geometry.mjs — 场景2 两项断言失败的活体诊断（fix-ui-friction-2026-10 冒烟）。
// 完整复现场景2 状态（写作页＋面板开＋新建讨论＋最大化），枚举全部 .ai-window 与
// .ai-window-actions 匹配及头部逐子元素矩形，定位「头部通栏 1005px 但动作组右缘 250px」
// 矛盾的具体元素。只读测量；结束后恢复常宽、关列表（新建的空讨论不发送、不落盘）。
import { connect } from './cdp-client.mjs';

const cdp = await connect(9223);

const PROBE = `(() => {
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
    return { l: +b.left.toFixed(1), r: +b.right.toFixed(1), t: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const CS = (e, props) => { if (!e) return null; const s = getComputedStyle(e);
    return Object.fromEntries(props.map((p) => [p, s.getPropertyValue(p)])); };
  const dock = document.getElementById('ai-dock');
  const windows = [...document.querySelectorAll('#ai-dock-body .ai-window')].map((w, i) => ({
    index: i,
    classes: [...w.classList],
    cs: CS(w, ['display', 'visibility', 'position']),
    win: R(w),
    headChildren: [...(w.querySelector(':scope > .ai-window-head')?.children ?? [])].map((c) => ({
      tag: c.tagName, cls: [...c.classList].join('.'), rect: R(c),
      ...(c.classList.contains('ai-window-actions') ? { buttons: [...c.querySelectorAll('button')].map((b) => ({ label: (b.getAttribute('title') || b.textContent || '').trim().slice(0, 10), hidden: b.classList.contains('hidden'), rect: R(b) })) } : {}),
    })),
  }));
  const actionMatches = [...document.querySelectorAll('#ai-dock-body .ai-window-actions')].map((a, i) => ({
    index: i, rect: R(a), insideWindowClasses: [...(a.closest('.ai-window')?.classList ?? [])],
  }));
  return {
    viewport: [innerWidth, innerHeight],
    maximized: dock.classList.contains('ai-panel-maximized'),
    dock: R(dock),
    windowCount: windows.length,
    actionMatchCount: actionMatches.length,
    windows, actionMatches,
  };
})()`;

async function snap(label) {
  const d = await cdp.evaluate(PROBE);
  console.log('==== ' + label + ' ====');
  console.log(JSON.stringify(d, null, 1));
}

// 复现场景2 前置
await cdp.evaluate(`document.getElementById('tab-writing')?.click()`);
await cdp.pause(600);
let vis = await cdp.evaluate(`(() => { const d=document.getElementById('ai-dock'); return !!d && !d.classList.contains('hidden') && d.getBoundingClientRect().width>0; })()`);
if (!vis) { await cdp.evaluate(`document.getElementById('btn-toggle-ai')?.click()`); await cdp.pause(600); }
await snap('写作页·常宽·复现前');

// 打开列表→新建讨论（与冒烟场景2 相同路径）
const listHidden = await cdp.evaluate(`document.querySelector('#ai-conversation-list')?.classList.contains('hidden') ?? true`);
if (listHidden) { await cdp.evaluate(`document.getElementById('ai-conversation-list-toggle')?.click()`); await cdp.pause(500); }
await cdp.evaluate(`document.getElementById('ai-list-new-conversation')?.click()`);
await cdp.pause(800);
await cdp.evaluate(`document.getElementById('ai-conversation-list-close')?.click()`);
await cdp.pause(400);

// 最大化→测量→恢复
await cdp.click('#ai-dock-maximize');
await cdp.pause(500);
await snap('最大化·新建讨论后');
await cdp.click('#ai-dock-maximize');
await cdp.pause(300);
console.log('已恢复常宽。诊断完成。');
cdp.close?.();

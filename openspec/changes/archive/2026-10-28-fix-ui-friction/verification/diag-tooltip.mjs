// diag-tooltip.mjs — 用户报告「最大化/恢复按钮悬停出现两个黑色提示文字」的活体诊断
// （fix-ui-friction-2026-10 验收期间）。只读测量＋真实悬停模拟，不改状态。
import { connect } from './cdp-client.mjs';

const cdp = await connect(9223);

// 0) 确保写作页与面板可见
await cdp.evaluate(`document.getElementById('tab-writing')?.click()`);
await cdp.pause(500);
const vis = await cdp.evaluate(`(() => { const d=document.getElementById('ai-dock'); return !!d && !d.classList.contains('hidden') && d.getBoundingClientRect().width>0; })()`);
if (!vis) { await cdp.evaluate(`document.getElementById('btn-toggle-ai')?.click()`); await cdp.pause(600); }

// 1) 样式表扫描：谁定义了 [data-tooltip] 伪元素提示
const sheetRules = await cdp.evaluate(`(() => {
  const hits = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => { for (const r of list) {
      if (r.selectorText && r.selectorText.includes('data-tooltip')) hits.push({ sheet: sheet.href ?? 'inline', sel: r.selectorText, css: r.style?.cssText ?? '' });
      if (r.cssRules) walk(r.cssRules);
    } };
    walk(rules);
  }
  return hits;
})()`);

// 2) 最大化按钮的伪元素与属性状态
const btnState = await cdp.evaluate(`(() => {
  const b = document.getElementById('ai-dock-maximize');
  if (!b) return { missing: true };
  const r = b.getBoundingClientRect();
  const cs = (pseudo) => { const s = getComputedStyle(b, pseudo);
    return { display: s.display, content: s.content, background: s.backgroundColor, position: s.position }; };
  return { rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    text: b.textContent.trim(), title: b.getAttribute('title'), dataTooltip: b.dataset.tooltip ?? null,
    ariaLabel: b.getAttribute('aria-label'), before: cs('::before'), after: cs('::after') };
})()`);

// 3) 真实悬停（mouseMoved 到按钮中心），看共享 #ui-tooltip 是否出现
const hover = await cdp.evaluate(`(() => { const b=document.getElementById('ai-dock-maximize'); const r=b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover.x, y: hover.y, button: 'none' });
await cdp.pause(700);
const sharedTip = await cdp.evaluate(`(() => {
  const t = document.getElementById('ui-tooltip');
  if (!t) return { exists: false };
  const r = t.getBoundingClientRect();
  return { exists: true, hidden: t.classList.contains('hidden'), text: t.textContent,
    rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    bg: getComputedStyle(t).backgroundColor };
})()`);
await cdp.screenshot('evidence/诊断-最大化按钮双提示悬停.png').catch(() => {});
// 移开鼠标，收场
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8, button: 'none' });

console.log(JSON.stringify({ sheetRules, btnState, sharedTip }, null, 1));
cdp.close?.();

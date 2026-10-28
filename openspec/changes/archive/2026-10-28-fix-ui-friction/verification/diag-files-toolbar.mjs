// diag-files-toolbar.mjs — 用户报告「文档管理顶部 4 个按钮莫名分开」的活体诊断（fix-ui-friction-2026-10 验收期间）。
// 只读测量：切到文档管理页，量工具栏与其全部子元素的几何与关键计算样式。不改任何状态。
import { connect } from './cdp-client.mjs';

const cdp = await connect(9223);

await cdp.evaluate(`document.getElementById('tab-files')?.click()`);
await cdp.pause(600);

const data = await cdp.evaluate(`(() => {
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
    return { l: +b.left.toFixed(1), r: +b.right.toFixed(1), t: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const CS = (e, props) => { const s = getComputedStyle(e);
    return Object.fromEntries(props.map((p) => [p, s.getPropertyValue(p)])); };
  const bar = document.querySelector('.file-manager-toolbar');
  if (!bar) return { missing: true };
  return {
    viewport: [innerWidth, innerHeight],
    barRect: R(bar), barCS: CS(bar, ['display', 'justify-content', 'gap', 'flex-wrap', 'align-items']),
    children: [...bar.children].map((c) => ({
      tag: c.tagName, id: c.id || null, cls: [...c.classList].join('.').slice(0, 40),
      text: (c.textContent || '').trim().slice(0, 16), rect: R(c),
      cs: CS(c, ['margin-left', 'margin-right', 'flex', 'width']),
    })),
  };
})()`);

console.log(JSON.stringify(data, null, 1));
await cdp.screenshot('evidence/诊断-文档管理工具栏.png').catch(() => {});
cdp.close?.();

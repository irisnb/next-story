// diag-confirm-centering.mjs — 验证 .app-confirm 居中修复（margin:auto 补丁）：
// 合成一个最小确认窗（同类名同结构），showModal 后量其矩形与视口中心的偏差。
// 只做合成测量，不触发任何业务操作、不碰用户数据；结束即清理。
import { connect } from './cdp-client.mjs';

const cdp = await connect(9223);

const result = await cdp.evaluate(`(async () => {
  const d = document.createElement('dialog');
  d.className = 'app-confirm';
  d.innerHTML = '<h3>居中验证（合成）</h3><p>这是诊断脚手架合成的确认窗，仅用于测量位置，不会执行任何操作。</p>' +
    '<footer><button type="button" class="app-confirm-cancel">取消</button><button type="button" class="app-confirm-accept">确认</button></footer>';
  document.body.append(d);
  d.showModal();
  await new Promise((r) => setTimeout(r, 120));
  const b = d.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  const centerDX = +(((b.left + b.right) / 2) - vw / 2).toFixed(1);
  const centerDY = +(((b.top + b.bottom) / 2) - vh / 2).toFixed(1);
  const marginAuto = getComputedStyle(d).margin;
  const out = { rect: { l: +b.left.toFixed(1), t: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) },
    viewport: [vw, vh], centerDX, centerDY, computedMargin: marginAuto,
    centered: Math.abs(centerDX) <= 2 && Math.abs(centerDY) <= 2 };
  d.close();
  d.remove();
  return out;
})()`);

console.log(JSON.stringify(result, null, 1));
await cdp.screenshot('evidence/诊断-确认窗居中.png').catch(() => {});
cdp.close?.();

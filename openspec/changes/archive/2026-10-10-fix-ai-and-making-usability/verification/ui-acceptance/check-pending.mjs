import { connect } from './cdp-client.mjs';
const cdp = await connect(Number(process.argv[2] ?? 9225));
const s = await cdp.evaluate(`(() => {
  const w=document.querySelector('.ai-window');
  const vis=e=>!!e&&e.getBoundingClientRect().width>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const t=e=>(e?.innerText||'').replace(/\\s+/g,' ').trim();
  return {
    badge: t(w?.querySelector('[data-role="badge"]')),
    dot: w?.querySelector('[data-role="status-dot"]')?.className,
    pending: vis(w?.querySelector('[data-role="reading-request"]')),
    loading: vis(w?.querySelector('[data-role="loading"]')),
    conv: t(w?.querySelector('[data-role="conversation"]')).slice(0,400),
    allow: vis(w?.querySelector('[data-role="reading-allow"]')),
    deny: vis(w?.querySelector('[data-role="reading-deny"]')),
    reason: w?.querySelector('[data-role="reading-request-reason"]')?.textContent ?? null,
  };
})()`);
console.log(JSON.stringify(s, null, 2));
cdp.close();

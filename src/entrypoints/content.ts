import { defineContentScript } from 'wxt/utils/define-content-script';
import { capture, isFormField } from '@/lib/extract';
import { rpc } from '@/lib/rpc';

/**
 * Registered at runtime, only after the user grants page access. Collects:
 * a content snapshot, max scroll depth, counts of clicks/keypresses (never what was typed),
 * and a true/false "form started" flag (never field values).
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  registration: 'runtime',
  runAt: 'document_idle',
  async main() {
    const w = window as typeof window & { __tablens?: boolean };
    if (w.__tablens) return;
    w.__tablens = true;

    const { capture: allowed } = await rpc('shouldCapture', { url: location.href }).catch(() => ({ capture: false }));
    if (!allowed) return;

    let maxScroll = 0;
    let sentScroll = 0;
    let interactions = 0;
    let formStarted = false;
    let lastUrl = location.href;

    const scrollDepth = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      if (h <= 50) return 100; // Short pages are fully seen.
      return Math.min(100, Math.round((window.scrollY / h) * 100));
    };

    const sendSnapshot = () => {
      const run = () => rpc('snapshot', { snapshot: capture() }).catch(() => {});
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 });
      else setTimeout(run, 1500);
    };

    // Snapshot once the page settles; SPAs often fill content after load.
    setTimeout(sendSnapshot, 1200);

    let scrollTimer: number | undefined;
    window.addEventListener(
      'scroll',
      () => {
        if (scrollTimer) return;
        scrollTimer = window.setTimeout(() => {
          scrollTimer = undefined;
          maxScroll = Math.max(maxScroll, scrollDepth());
          if (maxScroll - sentScroll >= 5 || (maxScroll === 100 && sentScroll < 100)) {
            sentScroll = maxScroll;
            rpc('metrics', { maxScroll }).catch(() => {});
          }
        }, 800);
      },
      { passive: true },
    );

    const bump = () => interactions++;
    window.addEventListener('click', bump, { capture: true, passive: true });
    window.addEventListener('keydown', bump, { capture: true, passive: true });

    window.addEventListener(
      'input',
      (e) => {
        if (formStarted || !isFormField(e.target)) return;
        const el = e.target as HTMLInputElement;
        if (!el.value) return;
        formStarted = true;
        rpc('metrics', { formStarted: true }).catch(() => {});
      },
      { capture: true },
    );
    window.addEventListener('submit', () => {
      if (!formStarted) return;
      formStarted = false;
      rpc('metrics', { formStarted: false }).catch(() => {});
    }, { capture: true });

    // Heartbeat while visible: flushes interaction counts and active time.
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const delta = interactions;
      interactions = 0;
      rpc('metrics', { interactions: delta, heartbeat: document.hasFocus() }).catch(() => {});
      // SPA route changes don't reload the script; re-snapshot on URL change.
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        maxScroll = sentScroll = 0;
        formStarted = false;
        sendSnapshot();
      }
    }, 15_000);

    chrome.runtime.onMessage.addListener((msg: { __tablensNudge?: { targetTabId: number; title: string; where: string } }) => {
      if (msg?.__tablensNudge) showNudge(msg.__tablensNudge);
    });
  },
});

/** The "already open" chip. Shadow DOM so page CSS can't touch it. */
function showNudge(n: { targetTabId: number; title: string; where: string }) {
  document.getElementById('tablens-nudge')?.remove();
  const host = document.createElement('div');
  host.id = 'tablens-nudge';
  host.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;right:20px;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .chip{font:500 13px/1.35 system-ui,-apple-system,sans-serif;color:#18202B;background:#fff;border:1px solid #E2E5EA;border-radius:12px;
        box-shadow:0 8px 28px rgba(24,32,43,.18);padding:12px 12px 12px 14px;display:flex;gap:12px;align-items:center;max-width:380px;
        animation:in .18s ease-out}
      @media (prefers-color-scheme:dark){.chip{background:#1B1F26;color:#E8EBF0;border-color:#2A2F38}}
      @media (prefers-reduced-motion:reduce){.chip{animation:none}}
      @keyframes in{from{transform:translateY(8px);opacity:0}}
      .bar{width:4px;align-self:stretch;border-radius:4px;background:#D63F86}
      .t{flex:1;min-width:0}.t b{display:block;font-weight:600}.t span{display:block;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      button{font:600 12px system-ui,sans-serif;border-radius:8px;padding:7px 10px;cursor:pointer;border:1px solid transparent}
      .go{background:#18202B;color:#fff}.x{background:transparent;color:inherit;opacity:.7}
      @media (prefers-color-scheme:dark){.go{background:#E8EBF0;color:#14171C}}
      button:focus-visible{outline:2px solid #3049D9;outline-offset:2px}
    </style>
    <div class="chip" role="status">
      <div class="bar"></div>
      <div class="t"><b>Already open ${n.where}</b><span></span></div>
      <button class="go">Switch to it</button>
      <button class="x" aria-label="Dismiss">Keep both</button>
    </div>`;
  root.querySelector('.t span')!.textContent = n.title;
  root.querySelector('.go')!.addEventListener('click', () => {
    rpc('switchToDuplicate', { targetTabId: n.targetTabId, closeSelf: true }).catch(() => {});
    host.remove();
  });
  root.querySelector('.x')!.addEventListener('click', () => host.remove());
  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), 12_000);
}

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

    chrome.runtime.onMessage.addListener((msg: Message, _sender, reply) => {
      if (msg?.__tablensNudge) showNudge(msg.__tablensNudge);
      if (msg?.__tablensJoin) {
        showJoin(msg.__tablensJoin);
        reply(true); // tells the background the prompt is on screen
      }
    });
  },
});

type Message = {
  __tablensNudge?: { targetTabId: number; title: string; where: string };
  __tablensJoin?: { group: string; color: string; where: string; moves: boolean };
};

const GROUP_COLORS: Record<string, string> = {
  grey: '#5F6368', blue: '#1A73E8', red: '#D93025', yellow: '#F9AB00', green: '#188038',
  pink: '#D01884', purple: '#9334E6', cyan: '#007B83', orange: '#FA903E',
};

/**
 * A small chip in the corner of the page. Shadow DOM so page CSS can't touch it, closed so page
 * scripts can't read it. The markup is static; everything dynamic goes in as text.
 */
function showChip(o: {
  id: string;
  title: string;
  detail: string;
  accent: string;
  primary: string;
  secondary: string;
  link?: string;
  timeoutMs: number;
  onPrimary: () => void;
  onSecondary: () => void;
  onLink?: () => void;
}) {
  document.getElementById(o.id)?.remove();
  const host = document.createElement('div');
  host.id = o.id;
  host.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;right:20px;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .chip{font:500 13px/1.35 system-ui,-apple-system,sans-serif;color:#18202B;background:#fff;border:1px solid #E2E5EA;border-radius:12px;
        box-shadow:0 8px 28px rgba(24,32,43,.18);padding:12px 12px 12px 14px;display:flex;gap:12px;align-items:center;max-width:420px;
        animation:in .18s ease-out}
      @media (prefers-color-scheme:dark){.chip{background:#1B1F26;color:#E8EBF0;border-color:#2A2F38}}
      @media (prefers-reduced-motion:reduce){.chip{animation:none}}
      @keyframes in{from{transform:translateY(8px);opacity:0}}
      .bar{width:4px;align-self:stretch;border-radius:4px;background:#D63F86}
      .t{flex:1;min-width:0}.t b{display:block;font-weight:600}.t span{display:block;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .t a{display:none;margin-top:4px;font-size:12px;opacity:.7;color:inherit;text-decoration:underline;cursor:pointer}
      .t a.on{display:inline-block}
      .btns{display:flex;flex-direction:column;gap:6px}
      button{font:600 12px system-ui,sans-serif;border-radius:8px;padding:7px 10px;cursor:pointer;border:1px solid transparent;white-space:nowrap}
      .go{background:#18202B;color:#fff}.x{background:transparent;color:inherit;opacity:.7}
      @media (prefers-color-scheme:dark){.go{background:#E8EBF0;color:#14171C}}
      button:focus-visible,a:focus-visible{outline:2px solid #3049D9;outline-offset:2px}
    </style>
    <div class="chip" role="status">
      <div class="bar"></div>
      <div class="t"><b></b><span></span><a href="#" tabindex="0"></a></div>
      <div class="btns"><button class="go"></button><button class="x"></button></div>
    </div>`;
  const $ = (sel: string) => root.querySelector(sel) as HTMLElement;
  $('.bar').style.background = o.accent;
  $('.t b').textContent = o.title;
  $('.t span').textContent = o.detail;
  $('.t span').title = o.detail;
  $('.go').textContent = o.primary;
  $('.x').textContent = o.secondary;
  if (o.link && o.onLink) {
    const a = $('.t a');
    a.textContent = o.link;
    a.classList.add('on');
    a.addEventListener('click', (e) => {
      e.preventDefault();
      o.onLink!();
    });
  }
  $('.go').addEventListener('click', () => {
    o.onPrimary();
    host.remove();
  });
  $('.x').addEventListener('click', () => {
    o.onSecondary();
    host.remove();
  });
  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), o.timeoutMs);
}

/** The "already open" chip. */
function showNudge(n: { targetTabId: number; title: string; where: string }) {
  showChip({
    id: 'tablens-nudge',
    title: `Already open ${n.where}`,
    detail: n.title,
    accent: '#D63F86',
    primary: 'Switch to it',
    secondary: 'Keep both',
    timeoutMs: 12_000,
    onPrimary: () => rpc('switchToDuplicate', { targetTabId: n.targetTabId, closeSelf: true }).catch(() => {}),
    onSecondary: () => {},
  });
}

/**
 * "Add this tab to the group?" — shown instead of moving the tab while the user is on it.
 * No is remembered for this tab and group; letting it time out just means "not now".
 */
function showJoin(j: { group: string; color: string; where: string; moves: boolean }) {
  showChip({
    id: 'tablens-join',
    title: j.moves ? `This tab fits “${j.group}” ${j.where}` : `This tab fits “${j.group}”`,
    detail: j.moves ? 'Adding it moves this tab to that window.' : 'Add it to the group in this window?',
    accent: GROUP_COLORS[j.color] ?? '#3049D9',
    primary: j.moves ? 'Move to group' : 'Add to group',
    secondary: 'No',
    link: 'Group new tabs automatically in Settings',
    timeoutMs: 25_000,
    onPrimary: () => rpc('answerJoin', { group: j.group, accept: true }).catch(() => {}),
    onSecondary: () => rpc('answerJoin', { group: j.group, accept: false }).catch(() => {}),
    onLink: () => rpc('openSettings', { section: 'grouping' }).catch(() => {}),
  });
}

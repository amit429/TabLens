import type { TabRecord, TabView } from '../types';
import { normalizeUrl, hostnameOf } from '../url';

export const NOW = Date.UTC(2026, 10, 13, 12);
export const DAY = 86_400_000;

let nextId = 1;

export function tab(url: string, title: string, opts: Partial<TabView> & { rec?: Partial<TabRecord> | false; ago?: number } = {}): TabView {
  const id = opts.id ?? nextId++;
  const lastAccessed = NOW - (opts.ago ?? 0.1) * DAY;
  const record: TabRecord | undefined =
    opts.rec === false
      ? undefined
      : {
          tabId: id,
          url,
          normUrl: normalizeUrl(url),
          title,
          windowId: opts.windowId ?? 1,
          openedAt: lastAccessed - DAY,
          lastAccessed,
          activations: 2,
          activeMs: 60_000,
          maxScroll: 10,
          interactions: 4,
          formStarted: false,
          visits: [lastAccessed],
          keep: false,
          hasHistory: true,
          ...(opts.rec || {}),
        };
  return {
    id,
    windowId: 1,
    index: id,
    url,
    normUrl: normalizeUrl(url),
    title,
    domain: hostnameOf(url),
    pinned: false,
    audible: false,
    discarded: false,
    groupId: -1,
    incognito: false,
    lastAccessed,
    record,
    ...opts,
  };
}

export function resetIds() {
  nextId = 1;
}

/** A realistic mixed tab pile: laptop shopping, a work repo, ML reading, travel, plus noise. */
export function pile(): TabView[] {
  resetIds();
  const search = tab('https://www.google.com/search?q=best+laptops+under+80000', 'best laptops under 80000 - Google Search', { ago: 5 });
  return [
    search,
    tab('https://www.theverge.com/reviews/macbook-air-m4-review', 'MacBook Air M4 review: the best laptop for most people', { ago: 4, rec: { openerTabId: search.id, maxScroll: 92, activeMs: 300_000 } }),
    tab('https://www.amazon.in/Lenovo-ThinkPad-X1-Carbon-laptop/dp/B0C1', 'Lenovo ThinkPad X1 Carbon Gen 12 laptop : Amazon.in', { ago: 9, rec: { openerTabId: search.id, activeMs: 2000, activations: 1, maxScroll: 5 } }),
    tab('https://www.flipkart.com/asus-zenbook-14-oled-laptop/p/itm123', 'ASUS Zenbook 14 OLED laptop - Flipkart', { ago: 9, rec: { openerTabId: search.id, activeMs: 1500, activations: 1, maxScroll: 3 } }),
    tab('https://www.notebookcheck.net/Dell-XPS-13-laptop-review.html', 'Dell XPS 13 laptop review - battery life and display', { ago: 6, rec: { openerTabId: search.id, maxScroll: 50 } }),
    tab('https://github.com/acme/expense-app/pull/42', 'Fix receipt upload by dev · Pull Request #42 · acme/expense-app', { ago: 0.05 }),
    tab('https://github.com/acme/expense-app/issues/17', 'Receipts fail on Safari · Issue #17 · acme/expense-app', { ago: 1.5 }),
    tab('https://github.com/acme/expense-app', 'acme/expense-app: Expense tracking for small teams', { ago: 2 }),
    tab('https://arxiv.org/abs/1706.03762', 'Attention Is All You Need transformer paper', { ago: 2, rec: { maxScroll: 46 } }),
    tab('https://jalammar.github.io/illustrated-transformer/', 'The Illustrated Transformer – attention visualized', { ago: 3.5, rec: { maxScroll: 100, activeMs: 400_000 } }),
    tab('https://www.theverge.com/reviews/macbook-air-m4-review?utm_source=twitter', 'MacBook Air M4 review: the best laptop for most people', { ago: 8 }),
    tab('https://visa.example.gov/apply/form', 'Visa application form', { ago: 2, rec: { formStarted: true } }),
    tab('https://open.spotify.com/playlist/1', 'Deep Focus – Spotify', { ago: 0.01, audible: true }),
    tab('https://news.ycombinator.com/', 'Hacker News', { ago: 12, rec: { activeMs: 500, activations: 1 } }),
  ];
}

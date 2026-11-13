import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { analyze, UNSORTED_ID } from './analyze';
import { pageTypeFromUrl, searchQuery } from './pagetype';
import { NOW, DAY, pile, tab, resetIds } from '../__fixtures__/tabs';
import type { Rule } from '../types';

const settings: Settings = { ...DEFAULT_SETTINGS, installedAt: NOW - 30 * DAY };

async function run(tabs = pile(), rules: Rule[] = [], s = settings) {
  return analyze({ tabs, rules, groups: new Map(), settings: s, now: NOW });
}

describe('page types', () => {
  it('detects from URL', () => {
    expect(pageTypeFromUrl('https://github.com/acme/app/pull/4')).toBe('issue');
    expect(pageTypeFromUrl('https://github.com/acme/app')).toBe('repo');
    expect(pageTypeFromUrl('https://www.amazon.in/x/dp/B0C1')).toBe('product');
    expect(pageTypeFromUrl('https://www.google.com/search?q=hi')).toBe('search');
    expect(searchQuery('https://duckduckgo.com/?q=rust+async')).toBe('rust async');
  });
});

describe('analyze', () => {
  it('assigns every tab to exactly one mission', async () => {
    const tabs = pile();
    const a = await run(tabs);
    const seen = a.missions.flatMap((m) => m.tabIds).sort((x, y) => x - y);
    expect(seen).toEqual(tabs.map((t) => t.id).sort((x, y) => x - y));
    for (const t of tabs) expect(a.verdicts[t.id]!.missionId).toBeTruthy();
  });

  it('groups the laptop research and the repo into separate missions', async () => {
    const tabs = pile();
    const a = await run(tabs);
    const missionOf = (title: string) => a.verdicts[tabs.find((t) => t.title.startsWith(title))!.id]!.missionId;
    expect(missionOf('MacBook Air')).toBe(missionOf('Lenovo ThinkPad'));
    expect(missionOf('Dell XPS')).toBe(missionOf('MacBook Air'));
    expect(missionOf('Fix receipt')).toBe(missionOf('Receipts fail'));
    expect(missionOf('Fix receipt')).not.toBe(missionOf('MacBook Air'));
    const repo = a.missions.find((m) => m.id === missionOf('Fix receipt'))!;
    expect(repo.kind).toBe('work');
    expect(repo.name).toContain('expense-app');
  });

  it('derives states and protects unfinished and pinned work', async () => {
    const tabs = pile();
    const a = await run(tabs);
    const v = (title: string) => a.verdicts[tabs.find((t) => t.title.startsWith(title))!.id]!;
    expect(v('Visa application').state).toBe('unfinished');
    expect(v('Attention Is All').state).toBe('unfinished');
    expect(v('Deep Focus').state).toBe('protected');
    expect(v('Lenovo ThinkPad').state).toBe('abandoned');
    expect(v('Hacker News').state).toBe('abandoned');
    expect(v('Fix receipt').state).toBe('active');
    // The finished, engaged 3.5-day-old read stays simmering rather than stale.
    expect(v('The Illustrated').state).toBe('simmering');
  });

  it('flags the older copy as the duplicate', async () => {
    const tabs = pile();
    const a = await run(tabs);
    const copies = tabs.filter((t) => t.title.startsWith('MacBook Air'));
    const states = copies.map((t) => a.verdicts[t.id]!.state);
    expect(states).toContain('duplicate');
    const dupe = copies.find((t) => a.verdicts[t.id]!.state === 'duplicate')!;
    expect(dupe.lastAccessed).toBeLessThan(copies.find((t) => t !== dupe)!.lastAccessed);
  });

  it('never puts unfinished or protected tabs in the plan', async () => {
    const tabs = pile();
    const a = await run(tabs);
    const planned = new Set(a.plan.filter((p) => p.kind !== 'group-missions').flatMap((p) => p.tabIds));
    for (const t of tabs) {
      const st = a.verdicts[t.id]!.state;
      if (st === 'unfinished' || st === 'protected') expect(planned.has(t.id)).toBe(false);
    }
    expect(a.plan.find((p) => p.kind === 'close-duplicates')?.recommended).toBe(true);
    expect(a.plan.find((p) => p.kind === 'archive-stale')?.recommended ?? false).toBe(false);
  });

  it('labels pre-install tabs as no history during the first days', async () => {
    resetIds();
    const fresh = { ...settings, installedAt: NOW - DAY };
    const tabs = [tab('https://example.com/a', 'Old thing', { ago: 20, rec: { hasHistory: false } })];
    const a = await run(tabs, [], fresh);
    expect(a.verdicts[tabs[0]!.id]!.state).toBe('no-history');
  });

  it('applies correction rules before clustering', async () => {
    const tabs = pile();
    const rules: Rule[] = [{ id: 'r1', kind: 'url-prefix', pattern: 'github.com/acme/expense-app', missionName: 'Work: Expense app', createdFrom: 'test', createdAt: 1 }];
    const a = await run(tabs, rules);
    const m = a.missions.find((x) => x.name === 'Work: Expense app')!;
    expect(m.tabIds).toHaveLength(3);
    expect(a.verdicts[m.tabIds[0]!]!.evidence[0]!.code).toBe('rule');
  });

  it('respects titled Chrome groups as user missions', async () => {
    const tabs = pile().map((t) => (t.title.startsWith('Attention') || t.title.startsWith('The Illustrated') ? { ...t, groupId: 7 } : t));
    const a = await analyze({ tabs, rules: [], groups: new Map([[7, { title: 'ML reading', color: 'purple' as const }]]), settings, now: NOW });
    const m = a.missions.find((x) => x.name === 'ML reading')!;
    expect(m.source).toBe('user');
    expect(m.groupId).toBe(7);
    expect(m.color).toBe('purple');
  });

  it('explains every verdict', async () => {
    const a = await run();
    for (const v of Object.values(a.verdicts)) {
      expect(v.reasons.length).toBeGreaterThan(0);
      expect(v.evidence.length).toBeGreaterThan(0);
    }
  });

  it('uses the AI namer when given, and falls back on failure', async () => {
    const tabs = pile();
    const named = await analyze({
      tabs, rules: [], groups: new Map(), settings, now: NOW, engine: 'cloud',
      namer: async (clusters) => ({ missions: clusters.map((c) => ({ key: c.key, name: 'AI ' + c.suggestedName, kind: 'personal' })) }),
    });
    expect(named.engine).toBe('cloud');
    expect(named.missions.filter((m) => m.id !== UNSORTED_ID).some((m) => m.name.startsWith('AI '))).toBe(true);
    const failed = await analyze({ tabs, rules: [], groups: new Map(), settings, now: NOW, namer: async () => { throw new Error('x'); } });
    expect(failed.engine).toBe('heuristic');
  });

  it('ignores boilerplate words shared by every page', async () => {
    const boiler = ['cookies', 'newsletter', 'subscribe', 'privacy', 'account', 'menu', 'footer', 'copyright'];
    const tabs = pile().map((t) => ({
      ...t,
      snapshot: { normUrl: t.normUrl, url: t.url, title: t.title, pageType: 'other' as const, description: '', headings: [], text: '', keywords: boiler, capturedAt: NOW },
    }));
    const a = await run(tabs);
    const missionOf = (title: string) => a.verdicts[tabs.find((t) => t.title.startsWith(title))!.id]!.missionId;
    expect(missionOf('Fix receipt')).not.toBe(missionOf('MacBook Air'));
    expect(missionOf('Attention Is All')).not.toBe(missionOf('Lenovo ThinkPad'));
  });

  it('applies AI merges and placements', async () => {
    const tabs = pile();
    const base = await run(tabs);
    const free = base.missions.filter((m) => m.id !== UNSORTED_ID && m.source === 'heuristic');
    const a = await analyze({
      tabs, rules: [], groups: new Map(), settings, now: NOW, engine: 'cloud',
      namer: async (clusters, unsorted) => ({
        missions: clusters.map((c) => ({ key: c.key, name: 'M ' + c.key })),
        merges: clusters.length > 1 ? [{ from: clusters[1]!.key, into: clusters[0]!.key }] : [],
        assignments: unsorted.length ? [{ tabId: unsorted[0]!.id, key: clusters[0]!.key }] : [],
      }),
    });
    expect(a.missions.filter((m) => m.id !== UNSORTED_ID).length).toBe(free.length - 1 + (base.missions.length - free.length - 1));
    const merged = a.missions.find((m) => m.name.startsWith('M '))!;
    expect(merged.tabIds.some((id) => a.verdicts[id]!.evidence.some((e) => e.code === 'model'))).toBe(true);
  });

  it("doesn't chain unrelated tabs through Chrome's opener", async () => {
    const tabs = pile();
    // Every tab "opened from" the one before it, as Chrome reports for Ctrl+T tabs.
    for (let i = 1; i < tabs.length; i++) tabs[i]!.record!.openerTabId = tabs[i - 1]!.id;
    const a = await run(tabs);
    const missionOf = (title: string) => a.verdicts[tabs.find((t) => t.title.startsWith(title))!.id]!.missionId;
    expect(missionOf('Fix receipt')).not.toBe(missionOf('Lenovo ThinkPad'));
    expect(missionOf('Visa application')).not.toBe(missionOf('Fix receipt'));
  });

  it('handles 300 tabs quickly', async () => {
    resetIds();
    const topics = ['laptop battery', 'rust async tokio', 'pasta recipe', 'flight goa hotel', 'react hooks state', 'running shoes'];
    const tabs = Array.from({ length: 300 }, (_, i) => tab(`https://site${i % 40}.com/p/${i}`, `${topics[i % topics.length]} page ${i}`, { ago: (i % 15) }));
    const t0 = performance.now();
    const a = await run(tabs);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(a.counts.total).toBe(300);
  });
});

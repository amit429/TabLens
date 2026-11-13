import type { Settings } from '../settings';
import type { PageType, Reason, TabState, TabView, Verdict } from '../types';

export const DAY = 86_400_000;
const HOUR = 3_600_000;

export function formatAgo(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < HOUR) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < DAY) {
    const h = Math.round(ms / HOUR);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.round(ms / DAY);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const m = Math.round(d / 30);
  if (m < 12) return `${m} month${m === 1 ? '' : 's'} ago`;
  const y = Math.round(d / 365);
  return `${y} year${y === 1 ? '' : 's'} ago`;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * Engagement 0–1 per tab. Each input is normalised across the user's own tabs (log scale for
 * counts and time) so heavy and light users get comparable scores.
 */
export function engagementScores(tabs: TabView[], w: Settings['weights']): Map<number, number> {
  const recs = tabs.map((t) => t.record);
  const maxActive = Math.max(1, ...recs.map((r) => r?.activeMs ?? 0));
  const maxVisits = Math.max(1, ...recs.map((r) => r?.activations ?? 0));
  const maxInter = Math.max(1, ...recs.map((r) => r?.interactions ?? 0));
  const total = w.active + w.scroll + w.visits + w.interactions || 1;
  const out = new Map<number, number>();
  for (const t of tabs) {
    const r = t.record;
    if (!r) {
      out.set(t.id, 0);
      continue;
    }
    const a = Math.log1p(r.activeMs / 1000) / Math.log1p(maxActive / 1000);
    const s = Math.min(1, r.maxScroll / 100);
    const v = Math.log1p(r.activations) / Math.log1p(maxVisits);
    const i = Math.log1p(r.interactions) / Math.log1p(maxInter);
    out.set(t.id, (w.active * a + w.scroll * s + w.visits * v + w.interactions * i) / total);
  }
  return out;
}

export interface StateResult {
  state: TabState;
  flags: TabState[];
  verdict: Verdict;
  reasons: Reason[];
  duplicateOf?: number;
}

/** Groups tabs by normalised URL; returns a map of copy → primary (the most recently used copy is primary). */
export function findDuplicates(tabs: TabView[]): Map<number, number> {
  const byUrl = new Map<string, TabView[]>();
  for (const t of tabs) {
    if (!/^https?:/.test(t.normUrl)) continue;
    const list = byUrl.get(t.normUrl) ?? [];
    list.push(t);
    byUrl.set(t.normUrl, list);
  }
  const out = new Map<number, number>();
  for (const list of byUrl.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        Number(b.record?.formStarted ?? 0) - Number(a.record?.formStarted ?? 0) ||
        lastUsed(b) - lastUsed(a),
    );
    const primary = sorted[0]!;
    for (const copy of sorted.slice(1)) out.set(copy.id, primary.id);
  }
  return out;
}

/**
 * When TabLens has tracked a tab since it opened, its own record is the source of truth: Chrome's
 * lastAccessed also moves on session restore and window juggling that aren't real visits.
 */
export function lastUsed(t: TabView): number {
  if (t.record?.hasHistory) return t.record.lastAccessed || t.lastAccessed || 0;
  return Math.max(t.lastAccessed || 0, t.record?.lastAccessed || 0);
}

const READABLE: PageType[] = ['article', 'docs', 'other'];

export function deriveState(
  t: TabView,
  ctx: {
    now: number;
    settings: Settings;
    engagement: number;
    duplicateOf?: number;
    duplicateLabel?: string;
    pageType: PageType;
    installedAt: number;
  },
): StateResult {
  const { now, settings, engagement, pageType } = ctx;
  const th = settings.thresholds;
  const r = t.record;
  const flags: TabState[] = [];
  const idleMs = now - lastUsed(t);
  const days = idleMs / DAY;

  // Protected beats everything: it's never suggested for cleanup.
  const protectedReasons: Reason[] = [];
  if (t.pinned) protectedReasons.push({ code: 'pinned', text: 'Pinned' });
  if (t.audible) protectedReasons.push({ code: 'audible', text: 'Playing audio' });
  if (r?.keep) protectedReasons.push({ code: 'keep', text: 'You marked it Keep' });

  const formStarted = !!r?.formStarted;
  const partialRead =
    !!r && READABLE.includes(pageType) && r.maxScroll >= th.unfinishedMin && r.maxScroll <= th.unfinishedMax;
  const unfinished = formStarted || partialRead;
  const unfinishedReasons: Reason[] = [];
  if (formStarted) unfinishedReasons.push({ code: 'form', text: 'You started filling in a form here' });
  if (partialRead) unfinishedReasons.push({ code: 'partial-read', text: `Read ${Math.round(r!.maxScroll)}% — not finished` });

  if (ctx.duplicateOf !== undefined) flags.push('duplicate');
  if (unfinished) flags.push('unfinished');

  if (protectedReasons.length) {
    return { state: 'protected', flags, verdict: 'keep', reasons: [...protectedReasons, ...unfinishedReasons] };
  }
  if (unfinished) {
    return {
      state: 'unfinished',
      flags: flags.filter((f) => f !== 'unfinished'),
      verdict: 'finish',
      reasons: [...unfinishedReasons, { code: 'never-auto', text: 'Never suggested for cleanup until you finish or save it' }],
      duplicateOf: ctx.duplicateOf,
    };
  }
  if (ctx.duplicateOf !== undefined) {
    return {
      state: 'duplicate',
      flags: flags.filter((f) => f !== 'duplicate'),
      verdict: 'close-duplicate',
      reasons: [
        { code: 'duplicate', text: `Same page is also open${ctx.duplicateLabel ? ` in ${ctx.duplicateLabel}` : ''}` },
        { code: 'idle', text: `This copy was last used ${formatAgo(idleMs)}` },
      ],
      duplicateOf: ctx.duplicateOf,
    };
  }

  const noHistory = !r?.hasHistory && now - ctx.installedAt < th.staleDays * DAY;
  if (noHistory) {
    return {
      state: 'no-history',
      flags,
      verdict: 'none',
      reasons: [{ code: 'no-history', text: 'Open since before TabLens was installed — no activity recorded yet' }],
    };
  }

  const usage = usageReason(t, engagement);
  if (days < th.simmeringDays) {
    return { state: 'active', flags, verdict: 'keep', reasons: [{ code: 'recent', text: `Used ${formatAgo(idleMs)}` }, ...usage] };
  }
  if (days < th.staleDays) {
    return { state: 'simmering', flags, verdict: 'keep', reasons: [{ code: 'recent', text: `Last used ${formatAgo(idleMs)}` }, ...usage] };
  }
  if (days < th.abandonedDays) {
    if (engagement >= th.staleEngagement) {
      return {
        state: 'simmering',
        flags,
        verdict: 'keep',
        reasons: [{ code: 'engaged', text: `Last used ${formatAgo(idleMs)}, but you spent real time on it` }, ...usage],
      };
    }
    return {
      state: 'stale',
      flags,
      verdict: 'archive',
      reasons: [{ code: 'idle', text: `Not opened for ${Math.floor(days)} days` }, ...usage],
    };
  }
  return {
    state: 'abandoned',
    flags,
    verdict: 'archive',
    reasons: [{ code: 'idle', text: `Not opened for ${Math.floor(days)} days` }, ...usage],
  };
}

function usageReason(t: TabView, engagement: number): Reason[] {
  const r = t.record;
  if (!r) return [];
  if (r.maxScroll >= 90 && r.activeMs > 30_000) return [{ code: 'finished', text: `You read it to the end (${Math.round(r.maxScroll)}%)` }];
  if (engagement < 0.12) {
    const active = r.activeMs < 1000 ? 'never really looked at it' : `only ${formatDuration(r.activeMs)} active`;
    return [{ code: 'low-engagement', text: `Barely used — ${active}` }];
  }
  if (engagement > 0.5) return [{ code: 'engaged', text: `${r.activations} visits, ${formatDuration(r.activeMs)} active` }];
  return [];
}

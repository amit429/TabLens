import { db } from './db';
import { getSettings, isPaused, type Settings } from './settings';
import type { TabRecord } from './types';
import { normalizeUrl } from './url';

/**
 * Behaviour tracking. Everything is flushed to IndexedDB on every event because MV3 service
 * workers can be killed at any moment; the in-flight "who has focus since when" lives in
 * chrome.storage.session so it survives worker restarts.
 */

interface Focus {
  tabId: number;
  windowId: number;
  since: number;
}

const FOCUS_KEY = 'focus';
/** Never credit more than this in one flush: protects against sleep/hibernate gaps. */
const MAX_FLUSH_MS = 120_000;
const MAX_VISITS = 20;

async function getFocus(): Promise<Focus | null> {
  return ((await chrome.storage.session.get(FOCUS_KEY))[FOCUS_KEY] as Focus | undefined) ?? null;
}

async function setFocus(f: Focus | null) {
  await chrome.storage.session.set({ [FOCUS_KEY]: f });
}

function shouldTrack(tab: chrome.tabs.Tab | undefined, s: Settings): boolean {
  if (!tab || isPaused(s)) return false;
  if (tab.incognito && !s.privacy.trackIncognito) return false;
  return true;
}

export function newRecord(tab: chrome.tabs.Tab, now: number, hasHistory: boolean): TabRecord {
  const url = tab.url || tab.pendingUrl || '';
  return {
    tabId: tab.id!,
    url,
    normUrl: normalizeUrl(url),
    title: tab.title || url,
    favIconUrl: tab.favIconUrl,
    windowId: tab.windowId,
    openedAt: now,
    lastAccessed: (tab as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed || now,
    activations: 0,
    activeMs: 0,
    maxScroll: 0,
    interactions: 0,
    formStarted: false,
    openerTabId: tab.openerTabId,
    visits: [],
    keep: false,
    hasHistory,
  };
}

/** Adds elapsed foreground time to the focused tab and restarts the clock. */
export async function flush(now = Date.now()): Promise<void> {
  const f = await getFocus();
  if (!f) return;
  const elapsed = Math.min(MAX_FLUSH_MS, Math.max(0, now - f.since));
  if (elapsed > 0) {
    await db.tabs.where('tabId').equals(f.tabId).modify((r) => {
      r.activeMs += elapsed;
      r.lastAccessed = now;
    });
  }
  await setFocus({ ...f, since: now });
}

export async function focusTab(tabId: number, windowId: number, now = Date.now()) {
  await flush(now);
  const s = await getSettings();
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  if (!shouldTrack(tab, s)) {
    await setFocus(null);
    return;
  }
  await setFocus({ tabId, windowId, since: now });
  const existing = await db.tabs.get(tabId);
  if (!existing) {
    const r = newRecord(tab, now, true);
    r.activations = 1;
    r.visits = [now];
    r.lastAccessed = now;
    await db.tabs.put(r);
    return;
  }
  const last = existing.visits.at(-1) ?? 0;
  await db.tabs.update(tabId, {
    activations: existing.activations + 1,
    lastAccessed: now,
    hasHistory: true,
    // Rapid tab switching (Ctrl+Tab through tabs) shouldn't count as separate visits.
    visits: now - last > 30_000 ? [...existing.visits, now].slice(-MAX_VISITS) : existing.visits,
  });
}

export async function blur(now = Date.now()) {
  await flush(now);
  await setFocus(null);
}

export async function onTabCreated(tab: chrome.tabs.Tab) {
  if (tab.id === undefined) return;
  const s = await getSettings();
  if (!shouldTrack(tab, s)) return;
  const r = newRecord(tab, Date.now(), true);
  if (tab.openerTabId !== undefined) {
    const opener = await db.tabs.get(tab.openerTabId);
    r.openerUrl = opener?.url;
  }
  await db.tabs.put(r);
}

/** Navigation to a different page resets page-level signals (scroll, form, interactions). */
export async function onTabUpdated(tabId: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab): Promise<{ navigated: boolean }> {
  if (!change.url && !change.title && !change.favIconUrl) return { navigated: false };
  const s = await getSettings();
  if (!shouldTrack(tab, s)) return { navigated: false };
  const existing = await db.tabs.get(tabId);
  if (!existing) {
    await db.tabs.put(newRecord(tab, Date.now(), true));
    return { navigated: !!change.url };
  }
  const patch: Partial<TabRecord> = {};
  let navigated = false;
  if (change.url) {
    const norm = normalizeUrl(change.url);
    if (norm !== existing.normUrl) {
      navigated = true;
      Object.assign(patch, { maxScroll: 0, interactions: 0, formStarted: false });
    }
    Object.assign(patch, { url: change.url, normUrl: norm });
  }
  if (change.title) patch.title = change.title;
  if (change.favIconUrl) patch.favIconUrl = change.favIconUrl;
  patch.windowId = tab.windowId;
  await db.tabs.update(tabId, patch);
  return { navigated };
}

export async function onTabRemoved(tabId: number) {
  const f = await getFocus();
  if (f?.tabId === tabId) await blur();
  await db.tabs.delete(tabId);
}

export async function recordMetrics(tabId: number, m: { maxScroll?: number; interactions?: number; formStarted?: boolean; heartbeat?: boolean }) {
  const s = await getSettings();
  if (isPaused(s)) return;
  await db.tabs.where('tabId').equals(tabId).modify((r) => {
    if (m.maxScroll !== undefined) r.maxScroll = Math.max(r.maxScroll, Math.min(100, m.maxScroll));
    if (m.interactions) r.interactions += m.interactions;
    if (m.formStarted !== undefined) r.formStarted = m.formStarted;
  });
  if (m.heartbeat) {
    const f = await getFocus();
    if (f?.tabId === tabId) await flush();
  }
}

/**
 * Called on install and on browser start. Tab ids change across restarts, so existing records
 * are re-keyed by matching normalised URLs; tabs never seen before get a "no history" record.
 */
export async function reconcile(reason: 'install' | 'startup' | 'wake') {
  const now = Date.now();
  const s = await getSettings();
  const tabs = await chrome.tabs.query({});
  const records = await db.tabs.toArray();
  const liveIds = new Set(tabs.map((t) => t.id!));
  const byId = new Map(records.map((r) => [r.tabId, r]));
  const orphans = new Map<string, TabRecord[]>();
  for (const r of records) {
    if (liveIds.has(r.tabId) && byId.get(r.tabId)!.normUrl === normalizeUrl(tabs.find((t) => t.id === r.tabId)!.url ?? '')) continue;
    orphans.set(r.normUrl, [...(orphans.get(r.normUrl) ?? []), r]);
  }

  const puts: TabRecord[] = [];
  const keepIds = new Set<number>();
  for (const t of tabs) {
    if (t.id === undefined || !shouldTrack(t, s)) continue;
    const norm = normalizeUrl(t.url ?? '');
    const current = byId.get(t.id);
    if (current && current.normUrl === norm) {
      keepIds.add(t.id);
      continue;
    }
    const candidates = orphans.get(norm);
    const match = candidates?.shift();
    if (match) {
      puts.push({ ...match, tabId: t.id, windowId: t.windowId, title: t.title || match.title });
    } else {
      puts.push(newRecord(t, reason === 'install' ? now : now, reason !== 'install'));
      // A tab we have never seen after startup was restored by Chrome; it has no behaviour history.
      puts[puts.length - 1]!.hasHistory = false;
    }
    keepIds.add(t.id);
  }
  await db.transaction('rw', db.tabs, async () => {
    const stale = records.filter((r) => !keepIds.has(r.tabId)).map((r) => r.tabId);
    await db.tabs.bulkDelete(stale);
    await db.tabs.bulkPut(puts);
  });

  // Snapshot retention: drop snapshots for pages no longer open after N days.
  const openUrls = new Set(tabs.map((t) => normalizeUrl(t.url ?? '')));
  const cutoff = now - s.privacy.snapshotRetentionDays * 86_400_000;
  const old = await db.snapshots.where('capturedAt').below(cutoff).primaryKeys();
  await db.snapshots.bulkDelete(old.filter((k) => !openUrls.has(k)));

  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id !== undefined) await setFocus({ tabId: active.id, windowId: active.windowId, since: now });
}

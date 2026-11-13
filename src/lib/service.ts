import type { GroupColor } from './types';
import { analyze, buildPlan, UNSORTED_ID } from './analysis/analyze';
import { colorFor, slug } from './analysis/naming';
import { pickEngine } from './ai/router';
import { db, latestAnalysis } from './db';
import { getSettings } from './settings';
import type { Analysis, Mission, TabView } from './types';
import { hostnameOf, normalizeUrl } from './url';

/** Builds the analysis input from live Chrome state plus stored behaviour and snapshots. */
export async function collectTabs(): Promise<{ tabs: TabView[]; groups: Map<number, { title: string; color: GroupColor }> }> {
  // Only normal windows: popup and app windows can't hold tab groups.
  const [chromeTabs, chromeGroups] = await Promise.all([chrome.tabs.query({ windowType: 'normal' }), chrome.tabGroups.query({})]);
  const ids = chromeTabs.map((t) => t.id!).filter((id) => id !== undefined);
  const records = await db.tabs.bulkGet(ids);
  const recById = new Map(records.filter(Boolean).map((r) => [r!.tabId, r!]));
  const normUrls = chromeTabs.map((t) => normalizeUrl(t.url || t.pendingUrl || ''));
  const snaps = await db.snapshots.bulkGet(normUrls);
  const snapByUrl = new Map(snaps.filter(Boolean).map((s) => [s!.normUrl, s!]));
  const extId = chrome.runtime.id;
  const tabs: TabView[] = chromeTabs
    // Skip TabLens's own pages and empty new-tab pages.
    .filter((t) => t.id !== undefined && !(t.url ?? '').startsWith(`chrome-extension://${extId}`) && !/^(about:blank|chrome:\/\/newtab|chrome:\/\/new-tab-page)/.test(t.url || t.pendingUrl || ''))
    .map((t) => {
      const url = t.url || t.pendingUrl || '';
      const norm = normalizeUrl(url);
      return {
        id: t.id!,
        windowId: t.windowId,
        index: t.index,
        url,
        normUrl: norm,
        title: t.title || url,
        favIconUrl: t.favIconUrl,
        domain: hostnameOf(url),
        pinned: t.pinned,
        audible: !!t.audible,
        discarded: !!t.discarded,
        groupId: t.groupId ?? -1,
        incognito: t.incognito,
        lastAccessed: (t as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed ?? 0,
        record: recById.get(t.id!),
        snapshot: snapByUrl.get(norm),
      };
    });
  const groups = new Map(chromeGroups.map((g) => [g.id, { title: g.title ?? '', color: g.color as GroupColor }]));
  return { tabs, groups };
}

let running: Promise<Analysis> | null = null;

const AI_COOLDOWN_MS = 10 * 60_000;
/** How many unplaced tabs (new since the last AI run, or Unsorted) make an automatic AI run worthwhile. */
const AI_BACKLOG = 4;

async function lastAiAttempt(): Promise<number> {
  return ((await chrome.storage.local.get('lastAiAt')).lastAiAt as number | undefined) ?? 0;
}

/**
 * Runs an analysis. Gemini is used:
 *  - on `fresh` runs (first run after setup, Re-analyse, the daily run), always;
 *  - automatically when tabs pile up that no mission holds yet (new or Unsorted), at most every
 *    10 minutes so a flaky network or a spent quota never turns tab switching into API calls.
 * Otherwise the cheap heuristic pass runs and names stick from the last AI run.
 */
export function runAnalysis(opts: { fresh?: boolean } = {}): Promise<Analysis> {
  if (running) return running;
  running = (async () => {
    try {
      const settings = await getSettings();
      const [{ tabs, groups }, rules, prev] = await Promise.all([collectTabs(), db.rules.toArray(), latestAnalysis()]);
      const unplaced = prev ? tabs.filter((t) => !prev.verdicts[t.id] || prev.verdicts[t.id]!.missionId === UNSORTED_ID).length : tabs.length;
      const cooledDown = Date.now() - (await lastAiAttempt()) > AI_COOLDOWN_MS;
      const wantAi = opts.fresh || (cooledDown && (!prev || prev.engine === 'heuristic' || unplaced >= AI_BACKLOG));
      const ai = wantAi ? await pickEngine(settings) : { engine: 'heuristic' as const };
      if (ai.engine !== 'heuristic') await chrome.storage.local.set({ lastAiAt: Date.now() });
      const a = await analyze({
        tabs,
        rules,
        groups,
        settings,
        organizer: 'organizer' in ai ? ai.organizer : undefined,
        namer: 'namer' in ai ? ai.namer : undefined,
        engine: ai.engine === 'heuristic' ? undefined : ai.engine,
        previous: prev?.missions,
        sticky: opts.fresh ? 'user' : 'all',
      });
      // Between AI runs, keep showing which engine named the (sticky) missions.
      if (a.engine === 'heuristic' && prev && prev.engine !== 'heuristic' && a.missions.some((m) => m.source === 'model')) a.engine = prev.engine;
      await saveAnalysis(a);
      return a;
    } finally {
      running = null;
    }
  })();
  return running;
}

export async function saveAnalysis(a: Analysis) {
  await db.transaction('rw', db.analyses, async () => {
    await db.analyses.put(a);
    const old = await db.analyses.orderBy('createdAt').reverse().offset(3).primaryKeys();
    await db.analyses.bulkDelete(old);
  });
  await updateBadge(a);
}

export async function updateBadge(a?: Analysis) {
  const settings = await getSettings();
  a ??= await latestAnalysis();
  const n = settings.features.badge && a ? a.counts.canGo : 0;
  await chrome.action.setBadgeText({ text: n > 0 ? String(n > 99 ? '99+' : n) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#E8692A' });
  await chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' });
}

/** Applies an in-place edit to the latest analysis (rename, move, merge) so every surface updates instantly. */
export async function editAnalysis(fn: (a: Analysis) => void): Promise<Analysis | undefined> {
  const a = await latestAnalysis();
  if (!a) return undefined;
  fn(a);
  const { tabs, groups } = await collectTabs();
  a.plan = buildPlan(a.missions, a.verdicts, new Map(tabs.map((t) => [t.id, t])), groups);
  await db.analyses.put(a);
  return a;
}

export function findMission(a: Analysis, id: string): Mission | undefined {
  return a.missions.find((m) => m.id === id);
}

/** Moves a tab between missions inside the analysis record. Creates the mission if needed. */
export function reassign(a: Analysis, tabId: number, missionId: string, beforeTabId?: number) {
  for (const m of a.missions) m.tabIds = m.tabIds.filter((id) => id !== tabId);
  let target = findMission(a, missionId);
  if (!target && missionId === UNSORTED_ID) {
    target = { id: UNSORTED_ID, name: 'Unsorted', intent: '', kind: 'personal', color: 'grey', tabIds: [], confidence: 0, source: 'heuristic', keywords: [] };
    a.missions.push(target);
  }
  if (!target) throw new Error('That mission no longer exists. Re-analyse and try again.');
  const t = target;
  const at = beforeTabId !== undefined ? t.tabIds.indexOf(beforeTabId) : -1;
  if (at >= 0) t.tabIds.splice(at, 0, tabId);
  else t.tabIds.push(tabId);
  const v = a.verdicts[tabId];
  if (v) {
    v.missionId = t.id;
    v.evidence = [{ code: 'user-move', text: 'You moved it here' }];
  }
  a.missions = a.missions.filter((m) => m.tabIds.length > 0 || m.source === 'user');
}

export function newMission(a: Analysis, name: string): Mission {
  let id = slug(name);
  for (let i = 2; a.missions.some((m) => m.id === id); i++) id = `${slug(name)}-${i}`;
  const m: Mission = { id, name, intent: '', kind: 'personal', color: colorFor(name), tabIds: [], confidence: 1, source: 'user', keywords: [] };
  a.missions.splice(Math.max(0, a.missions.length - 1), 0, m);
  return m;
}

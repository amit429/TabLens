import { defineBackground } from 'wxt/utils/define-background';
import { cloudStatus, nanoStatus, summarize } from '@/lib/ai/router';
import { db, latestAnalysis, wipeAll } from '@/lib/db';
import * as ex from '@/lib/executor';
import { saveForLater, touchSeen } from '@/lib/library';
import { serveRpc, type RpcHandlers } from '@/lib/rpc';
import { runAnalysis, updateBadge } from '@/lib/service';
import { DEFAULT_SETTINGS, getSettings, isPaused, updateSettings } from '@/lib/settings';
import { keywords } from '@/lib/text';
import * as tracker from '@/lib/tracker';
import { WEB_ORIGINS, isExcluded, isReadableUrl, normalizeUrl } from '@/lib/url';
import { DAY } from '@/lib/analysis/states';

const CONTENT_ID = 'tablens-content';
const CONTENT_FILE = 'content-scripts/content.js';

export default defineBackground({
  type: 'module',
  main() {
    // ---------- Lifecycle ----------
    chrome.runtime.onInstalled.addListener(async ({ reason }) => {
      const s = await getSettings();
      if (!s.installedAt) await updateSettings({ installedAt: Date.now() });
      if (!s.installId) await updateSettings({ installId: crypto.randomUUID() });
      await tracker.reconcile(reason === 'install' ? 'install' : 'wake');
      await ensureContentScripts();
      await setupMenus();
      await setupAlarms();
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
      if (reason === 'install') await chrome.tabs.create({ url: chrome.runtime.getURL('/dashboard.html#/welcome') });
      scheduleAnalysis(500);
    });

    chrome.runtime.onStartup.addListener(async () => {
      await tracker.reconcile('startup');
      await ensureContentScripts();
      await setupAlarms();
      scheduleAnalysis(5000);
    });

    chrome.permissions.onAdded.addListener(async (p) => {
      if (p.origins?.length) {
        await ensureContentScripts();
        await injectIntoOpenTabs();
      }
    });
    chrome.permissions.onRemoved.addListener(async (p) => {
      if (p.origins?.length) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_ID] }).catch(() => {});
    });

    // ---------- Tracking ----------
    chrome.tabs.onCreated.addListener(async (tab) => {
      await tracker.onTabCreated(tab);
      scheduleAnalysis();
    });
    chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
      const { navigated } = await tracker.onTabUpdated(tabId, change, tab);
      if (change.status === 'complete' && tab.url) {
        if (tab.active) touchSeen(tab.url).catch(() => {});
        await maybeNudge(tab);
      }
      if (navigated || change.status === 'complete' || change.groupId !== undefined || change.pinned !== undefined) scheduleAnalysis();
    });
    chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
      await tracker.focusTab(tabId, windowId);
      const t = await chrome.tabs.get(tabId).catch(() => undefined);
      if (t?.url) touchSeen(t.url).catch(() => {});
    });
    chrome.tabs.onRemoved.addListener(async (tabId) => {
      await tracker.onTabRemoved(tabId);
      scheduleAnalysis();
    });
    chrome.tabs.onAttached.addListener(() => scheduleAnalysis());
    chrome.tabGroups.onUpdated.addListener(() => scheduleAnalysis(4000));
    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) return tracker.blur();
      const [t] = await chrome.tabs.query({ active: true, windowId });
      if (t?.id !== undefined) await tracker.focusTab(t.id, windowId);
    });
    chrome.idle.setDetectionInterval(60);
    chrome.idle.onStateChanged.addListener(async (state) => {
      if (state !== 'active') return tracker.blur();
      const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (t?.id !== undefined) await tracker.focusTab(t.id, t.windowId);
    });

    // ---------- Alarms ----------
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'flush') return tracker.flush();
      if (alarm.name === 'daily') {
        const s = await getSettings();
        if (s.features.dailyAnalysis) await runAnalysis({ fresh: true });
        return;
      }
      if (alarm.name === 'digest') return weeklyDigest();
      if (alarm.name.startsWith('snooze:')) return ex.wakeSnoozed(alarm.name.slice(7));
      if (alarm.name.startsWith('remind:')) return remind(alarm.name.slice(7));
    });

    // ---------- Commands & menus ----------
    chrome.commands.onCommand.addListener(async (command, tab) => {
      if (command === 'open-dashboard') await openDashboard();
      if (command === 'open-side-panel' && tab?.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId });
    });

    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
      if (!tab?.id) return;
      if (info.menuItemId === 'save') {
        await chrome.storage.session.set({ sidePanelView: 'save' });
        await chrome.sidePanel.open({ tabId: tab.id });
      }
      if (info.menuItemId === 'save-link' && info.linkUrl) {
        await saveForLater({ url: info.linkUrl, title: info.selectionText || info.linkUrl, intent: 'read', note: '' });
      }
      if (info.menuItemId === 'keep') await ex.setKeep([tab.id], true);
      if (info.menuItemId === 'snooze') await ex.archiveTabs([tab.id], { snoozeUntil: tomorrowMorning(), reason: 'Snoozed until tomorrow' });
      if (info.menuItemId === 'dashboard') await openDashboard();
    });

    chrome.notifications?.onClicked.addListener(async (id) => {
      if (id === 'digest') await openDashboard();
      chrome.notifications.clear(id);
    });

    // ---------- RPC ----------
    const handlers: RpcHandlers = {
      analyze: ({ fresh }) => runAnalysis({ fresh }),
      applyPlan: async (p) => after(await ex.applyPlan(p)),
      archiveTabs: async ({ tabIds, reason }) => after(await ex.archiveTabs(tabIds, { reason })),
      closeTabs: async ({ tabIds }) => after(await ex.closeTabs(tabIds)),
      groupMissions: async ({ missionIds }) => ex.groupMissions(missionIds),
      moveTabToMission: async ({ tabId, missionId, beforeTabId, remember }) => ex.moveTabToMission(tabId, missionId, beforeTabId, remember),
      createMission: async ({ name, tabIds }) => ex.createMission(name, tabIds),
      renameMission: async ({ missionId, name }) => ex.renameMission(missionId, name),
      recolorMission: async ({ missionId, color }) => ex.recolorMission(missionId, color),
      mergeMissions: async ({ fromId, intoId }) => ex.mergeMissions(fromId, intoId),
      archiveMission: async ({ missionId, onlyStale }) => after(await ex.archiveMission(missionId, onlyStale)),
      focusMission: async ({ missionId }) => ex.focusMission(missionId),
      setKeep: async ({ tabIds, keep }) => {
        await ex.setKeep(tabIds, keep);
        await updateBadge();
      },
      snoozeTabs: async ({ tabIds, until }) => after(await ex.archiveTabs(tabIds, { snoozeUntil: until, reason: `Snoozed until ${new Date(until).toLocaleString()}` })),
      openTab: async ({ tabId }) => ex.openTab(tabId),
      openUrl: async ({ url, newWindow }) => {
        if (newWindow) await chrome.windows.create({ url });
        else await chrome.tabs.create({ url });
      },
      restoreArchive: async ({ ids, newWindow }) => ex.restoreArchive(ids, newWindow),
      deleteArchive: async ({ ids }) => {
        const entries = await db.archive.bulkGet(ids);
        for (const b of new Set(entries.map((e) => e?.batchId).filter(Boolean))) await chrome.alarms.clear(`snooze:${b}`);
        await db.archive.bulkDelete(ids);
      },
      undo: async ({ undoId }) => {
        const r = await ex.undo(undoId);
        scheduleAnalysis(800);
        return r;
      },
      saveForLater: async (s) => {
        const save = await saveForLater(s);
        if (s.closeTabId !== undefined) await chrome.tabs.remove(s.closeTabId).catch(() => {});
        return { saveId: save.id };
      },
      deleteRule: async ({ ruleId }) => {
        await db.rules.delete(ruleId);
      },
      enableContentReading: async () => {
        const granted = await chrome.permissions.contains({ origins: WEB_ORIGINS });
        if (granted) {
          await ensureContentScripts();
          await injectIntoOpenTabs();
        }
        return { granted };
      },
      aiStatus: async () => ({ nano: await nanoStatus() }),
      cloudStatus: async () => cloudStatus(await getSettings()),
      summarizeTab: async ({ tabId }) => {
        const t = await chrome.tabs.get(tabId);
        const snap = await db.snapshots.get(normalizeUrl(t.url ?? ''));
        if (!snap) return null;
        if (snap.aiSummary) return { summary: snap.aiSummary, topics: snap.aiTopics ?? [] };
        const r = await summarize(await getSettings(), snap);
        if (!r) return null;
        await db.snapshots.update(snap.normUrl, { aiSummary: r.summary, aiTopics: r.topics });
        return { summary: r.summary, topics: r.topics };
      },
      deleteAllData: async () => {
        await wipeAll();
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
        await chrome.alarms.clearAll();
        await setupAlarms();
        await updateSettings({ installedAt: Date.now(), onboarded: true, installId: crypto.randomUUID() });
        await updateBadge();
        const left = await Promise.all([db.tabs.count(), db.snapshots.count(), db.archive.count(), db.saves.count()]);
        return { ok: left.every((n) => n === 0) };
      },
      exportData: async () => {
        const [archive, saves, rules, bookmarkMeta] = await Promise.all([db.archive.toArray(), db.saves.toArray(), db.rules.toArray(), db.bookmarkMeta.toArray()]);
        const settings = await getSettings();
        return { json: JSON.stringify({ app: 'TabLens', version: 1, exportedAt: new Date().toISOString(), settings, archive, saves, rules, bookmarkMeta }, null, 2) };
      },
      importData: async ({ json }) => {
        try {
          const data = JSON.parse(json);
          if (data?.app !== 'TabLens') return { ok: false, message: 'That file is not a TabLens export.' };
          await db.transaction('rw', [db.archive, db.saves, db.rules, db.bookmarkMeta], async () => {
            await db.archive.bulkPut(data.archive ?? []);
            await db.saves.bulkPut(data.saves ?? []);
            await db.rules.bulkPut(data.rules ?? []);
            await db.bookmarkMeta.bulkPut(data.bookmarkMeta ?? []);
          });
          return { ok: true, message: `Imported ${data.archive?.length ?? 0} archived tabs, ${data.saves?.length ?? 0} saves and ${data.rules?.length ?? 0} rules.` };
        } catch (err) {
          return { ok: false, message: `Couldn't read the file: ${err instanceof Error ? err.message : err}` };
        }
      },
      shouldCapture: async ({ url }, sender) => {
        const s = await getSettings();
        const incognitoBlocked = sender.tab?.incognito && !s.privacy.trackIncognito;
        return { capture: !isPaused(s) && !incognitoBlocked && isReadableUrl(url) && !isExcluded(url, s.privacy.excludedDomains) };
      },
      snapshot: async ({ snapshot }, sender) => {
        const s = await getSettings();
        if (isPaused(s) || isExcluded(snapshot.url, s.privacy.excludedDomains)) return;
        const normUrl = normalizeUrl(snapshot.url);
        const prev = await db.snapshots.get(normUrl);
        await db.snapshots.put({
          ...snapshot,
          pageType: snapshot.pageType ?? 'other',
          normUrl,
          // Title and headings count several times so keywords describe the page, not its boilerplate.
          keywords: keywords(`${snapshot.title} `.repeat(3) + `${snapshot.description} ${snapshot.headings.join(' ')} `.repeat(2) + snapshot.text.split(/\s+/).slice(0, 600).join(' '), 10),
          capturedAt: Date.now(),
          // Keep an AI summary if the page text hasn't materially changed.
          aiSummary: prev && prev.text.slice(0, 500) === snapshot.text.slice(0, 500) ? prev.aiSummary : undefined,
          aiTopics: prev && prev.text.slice(0, 500) === snapshot.text.slice(0, 500) ? prev.aiTopics : undefined,
        });
        if (sender.tab?.id !== undefined && !(await db.tabs.get(sender.tab.id))) await tracker.onTabCreated(sender.tab);
        scheduleAnalysis(6000);
      },
      metrics: async (m, sender) => {
        if (sender.tab?.id !== undefined) await tracker.recordMetrics(sender.tab.id, m);
      },
      switchToDuplicate: async ({ targetTabId, closeSelf }, sender) => {
        await ex.openTab(targetTabId);
        if (closeSelf && sender.tab?.id !== undefined) await chrome.tabs.remove(sender.tab.id);
      },
    };
    serveRpc(handlers);
  },
});

/** After actions that close tabs, refresh the analysis so counts and the badge are current. */
function after<T>(r: T): T {
  scheduleAnalysis(600);
  return r;
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Cheap heuristic re-analysis after tab changes; AI names stick from the last full run. */
function scheduleAnalysis(ms = 2500) {
  clearTimeout(timer);
  timer = setTimeout(() => runAnalysis().catch((e) => console.warn('[TabLens] analysis failed', e)), ms);
}

async function ensureContentScripts() {
  const granted = await chrome.permissions.contains({ origins: WEB_ORIGINS });
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_ID] }).catch(() => []);
  if (!granted) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_ID] });
    return;
  }
  if (existing.length) return;
  await chrome.scripting.registerContentScripts([
    { id: CONTENT_ID, js: [CONTENT_FILE], matches: ['http://*/*', 'https://*/*'], runAt: 'document_idle', persistAcrossSessions: true },
  ]);
}

/** Pages already open when access is granted get the script now rather than on next load. */
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'], discarded: false });
  await Promise.all(tabs.map((t) => chrome.scripting.executeScript({ target: { tabId: t.id! }, files: [CONTENT_FILE] }).catch(() => {})));
}

async function setupMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'save', title: 'Save page to TabLens with a note…', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'save-link', title: 'Save link to TabLens', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'keep', title: 'Keep this tab (never suggest closing)', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'snooze', title: 'Snooze this tab until tomorrow', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'dashboard', title: 'Open TabLens dashboard', contexts: ['action'] });
}

async function setupAlarms() {
  await chrome.alarms.create('flush', { periodInMinutes: 0.5 });
  if (!(await chrome.alarms.get('daily'))) {
    const next = new Date();
    next.setHours(9, 0, 0, 0);
    if (next.getTime() < Date.now()) next.setDate(next.getDate() + 1);
    await chrome.alarms.create('daily', { when: next.getTime(), periodInMinutes: 24 * 60 });
  }
  if (!(await chrome.alarms.get('digest'))) await chrome.alarms.create('digest', { when: Date.now() + 7 * DAY, periodInMinutes: 7 * 24 * 60 });
}

async function openDashboard(hash = '') {
  const url = chrome.runtime.getURL('/dashboard.html');
  const [existing] = await chrome.tabs.query({ url: url + '*' });
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, ...(hash ? { url: url + hash } : {}) });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.tabs.create({ url: url + hash });
}

async function maybeNudge(tab: chrome.tabs.Tab) {
  const s = await getSettings();
  if (!s.features.alreadyOpenNudge || !tab.id || !tab.url || !tab.active) return;
  const rec = await db.tabs.get(tab.id);
  // Only nudge for freshly opened tabs, not ones the user returns to.
  if (!rec || Date.now() - rec.openedAt > 20_000) return;
  const norm = normalizeUrl(tab.url);
  if (!/^https?:/.test(norm)) return;
  const others = (await chrome.tabs.query({})).filter((t) => t.id !== tab.id && t.url && normalizeUrl(t.url) === norm);
  const target = others[0];
  if (!target?.id) return;
  const where = target.windowId === tab.windowId ? 'in this window' : 'in another window';
  await chrome.tabs.sendMessage(tab.id, { __tablensNudge: { targetTabId: target.id, title: target.title ?? target.url, where } }).catch(() => {});
}

async function weeklyDigest() {
  const s = await getSettings();
  if (!s.features.weeklyDigest) return;
  const a = (await latestAnalysis()) ?? (await runAnalysis());
  const old = Object.values(a.verdicts).filter((v) => v.state === 'abandoned');
  if (!old.length) return;
  const missions = new Set(old.map((v) => v.missionId)).size;
  chrome.notifications?.create('digest', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('/icon/128.png'),
    title: 'Your weekly tab check',
    message: `${old.length} tab${old.length === 1 ? '' : 's'} untouched for ${s.thresholds.abandonedDays}+ days across ${missions} mission${missions === 1 ? '' : 's'}. Click to review.`,
  });
}

async function remind(saveId: string) {
  const save = await db.saves.get(saveId);
  if (!save) return;
  chrome.notifications?.create(`remind:${saveId}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('/icon/128.png'),
    title: 'Reminder from your library',
    message: `${save.title}${save.note ? `\n${save.note}` : ''}`,
  });
  chrome.notifications?.onClicked.addListener(function open(id) {
    if (id !== `remind:${saveId}`) return;
    chrome.tabs.create({ url: save.url });
    chrome.notifications.onClicked.removeListener(open);
  });
}

function tomorrowMorning(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

export { DEFAULT_SETTINGS };

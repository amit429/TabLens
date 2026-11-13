/**
 * Multi-window grouping test against the real extension in Chromium (offline, fake pages).
 * Missions are deliberately split across three windows; checks the actual Chrome tab groups.
 *
 *   pnpm build:e2e && node scripts/e2e-windows.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EXT = path.join(root, '.output-e2e/chrome-mv3');
const exe =
  process.env.CHROME_BIN ||
  fs
    .readdirSync(path.join(os.homedir(), 'Library/Caches/ms-playwright'))
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .map((d) => path.join(os.homedir(), 'Library/Caches/ms-playwright', d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
    .filter((p) => fs.existsSync(p))
    .pop();
const log = (...a) => console.log('[windows]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = {
  'https://www.google.com/search?q=best+laptops+under+80000': ['best laptops under 80000 - Google Search', 'laptop'],
  'https://www.theverge.com/reviews/macbook-air-m4-review': ['MacBook Air M4 review: the best laptop battery life', 'laptop'],
  'https://www.amazon.in/Lenovo-ThinkPad-X1-Carbon-Laptop/dp/B0D1': ['Lenovo ThinkPad X1 Carbon laptop : Amazon.in', 'shopping'],
  'https://www.flipkart.com/asus-zenbook-14-oled-laptop/p/itm7a': ['ASUS Zenbook 14 OLED laptop - Flipkart', 'shopping'],
  'https://www.notebookcheck.net/Dell-XPS-13-laptop-review.html': ['Dell XPS 13 laptop review: battery life and display', 'laptop'],
  'https://github.com/acme/expense-app/pull/42': ['Fix receipt upload on Safari · Pull Request #42 · acme/expense-app', 'repo'],
  'https://github.com/acme/expense-app/issues/17': ['Receipts fail to upload on Safari · Issue #17 · acme/expense-app', 'repo'],
  'https://github.com/acme/expense-app': ['acme/expense-app: Expense tracking for small teams', 'repo'],
  'https://www.booking.com/searchresults.html?ss=Goa': ['Goa hotels: beach hotels in North Goa - Booking.com', 'goa'],
  'https://www.skyscanner.co.in/transport/flights/blr/goi/': ['Cheap flights from Bengaluru to Goa - Skyscanner', 'goa'],
  'https://www.tripadvisor.in/Attractions-Goa.html': ['Things to do in Goa: beaches and forts - Tripadvisor', 'goa'],
  'https://open.spotify.com/playlist/focus': ['Deep Focus – Spotify', 'pinned'],
  'https://www.rtings.com/laptop/tests/battery-life': ['Laptop battery life test - RTINGS', 'popup'],
  'https://www.laptopmag.com/reviews/lenovo-yoga-7-laptop': ['Lenovo Yoga 7 laptop review: battery life tested', 'late'],
};
const html = (title) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${title}"></head><body><h1>${title}</h1>${`<p>${title}. ${title.split(' ').reverse().join(' ')}.</p>`.repeat(8)}</body></html>`;

const W1 = ['https://www.google.com/search?q=best+laptops+under+80000', 'https://www.theverge.com/reviews/macbook-air-m4-review', 'https://github.com/acme/expense-app/pull/42', 'https://www.booking.com/searchresults.html?ss=Goa'];
const W2 = ['https://www.amazon.in/Lenovo-ThinkPad-X1-Carbon-Laptop/dp/B0D1', 'https://www.flipkart.com/asus-zenbook-14-oled-laptop/p/itm7a', 'https://github.com/acme/expense-app/issues/17', 'https://www.skyscanner.co.in/transport/flights/blr/goi/'];
const W3 = ['https://www.notebookcheck.net/Dell-XPS-13-laptop-review.html', 'https://github.com/acme/expense-app', 'https://www.tripadvisor.in/Attractions-Goa.html'];

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tablens-win-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  executablePath: exe,
  headless: !process.argv.includes('--headed'),
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run'],
});
await ctx.route(/^https?:\/\//, (route) => {
  const url = route.request().url();
  if (route.request().resourceType() !== 'document') return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ status: 200, contentType: 'text/html', body: html(PAGES[url]?.[0] ?? 'Page') });
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const base = `chrome-extension://${new URL(sw.url()).host}`;
await sleep(1200);

const ext = await ctx.newPage();
await ext.goto(`${base}/dashboard.html#/missions`);
const ev = (fn, arg) => ext.evaluate(fn, arg);
const rpc = (type, payload = {}) =>
  ev(async ([type, payload]) => {
    const r = await chrome.runtime.sendMessage({ __tablens: true, type, payload });
    if (!r?.ok) throw new Error(r?.error ?? 'no reply');
    return r.data;
  }, [type, payload]);
const setSettings = (patch) =>
  ev(async (patch) => {
    const s = (await chrome.storage.local.get('settings')).settings ?? {};
    const merged = { ...s, ...patch, grouping: { ...(s.grouping ?? {}), ...(patch.grouping ?? {}) } };
    await chrome.storage.local.set({ settings: merged });
  }, patch);
const allTabs = () => ev(() => chrome.tabs.query({}));
const allGroups = () => ev(() => chrome.tabGroups.query({}));

// Load every page through Playwright (so the offline fixtures answer), then split them into
// three normal windows, a popup window and a pinned tab using Chrome's own window API.
for (const url of [...W1, ...W2, ...W3, 'https://open.spotify.com/playlist/focus', 'https://www.rtings.com/laptop/tests/battery-life']) {
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
}
await sleep(4000); // snapshots
const win = await ev(
  async ([w1, w2, w3, pinned, popup]) => {
    const all = await chrome.tabs.query({});
    const id = (u) => all.find((t) => t.url === u).id;
    const a = await chrome.windows.create({ tabId: id(w1[0]) });
    await chrome.tabs.move(w1.slice(1).map(id), { windowId: a.id, index: -1 });
    await chrome.tabs.move(id(pinned), { windowId: a.id, index: 0 });
    await chrome.tabs.update(id(pinned), { pinned: true });
    const b = await chrome.windows.create({ tabId: id(w2[0]) });
    await chrome.tabs.move(w2.slice(1).map(id), { windowId: b.id, index: -1 });
    const c = await chrome.windows.create({ tabId: id(w3[0]) });
    await chrome.tabs.move(w3.slice(1).map(id), { windowId: c.id, index: -1 });
    const p = await chrome.windows.create({ tabId: id(popup), type: 'popup' });
    return { a: a.id, b: b.id, c: c.id, popup: p.id };
  },
  [W1, W2, W3, 'https://open.spotify.com/playlist/focus', 'https://www.rtings.com/laptop/tests/battery-life'],
);
log('windows', JSON.stringify(win));
await sleep(1500);

// Recent, tracked behaviour so nothing is "abandoned" and the plan only groups.
await ev(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('tablens');
    r.onsuccess = () => res(r.result);
  });
  const tx = db.transaction('tabs', 'readwrite');
  const st = tx.objectStore('tabs');
  const all = await new Promise((res) => {
    const g = st.getAll();
    g.onsuccess = () => res(g.result);
  });
  for (const r of all) st.put({ ...r, hasHistory: true, lastAccessed: Date.now() - 3_600_000, activations: 2, activeMs: 60_000 });
  await new Promise((r) => (tx.oncomplete = r));
});
await setSettings({ installedAt: Date.now() - 20 * 86_400_000, onboarded: true, grouping: { crossWindow: 'gather', autoSync: true } });

const a = await rpc('analyze', { fresh: true });
const tabs0 = await allTabs();
const byUrl = (u) => tabs0.find((t) => t.url === u);
const missionFor = (kind) => {
  const urls = Object.entries(PAGES).filter(([, [, k]]) => k === kind).map(([u]) => u);
  const ids = urls.map((u) => byUrl(u)?.id).filter(Boolean);
  const m = a.missions.find((m) => ids.every((id) => m.tabIds.includes(id)));
  assert.ok(m, `one mission holds every ${kind} tab (got ${ids.map((id) => a.verdicts[id]?.missionId).join(', ')})`);
  return m;
};
if (process.argv.includes('--debug')) for (const m of a.missions) log('M', m.name, m.confidence.toFixed(2), m.tabIds.map((id) => tabs0.find((t) => t.id === id)?.title?.slice(0, 30)).join(' | '));
const missions = { laptop: missionFor('laptop'), shopping: missionFor('shopping'), repo: missionFor('repo'), goa: missionFor('goa') };
for (const [k, m] of Object.entries(missions)) {
  const ws = new Set(m.tabIds.map((id) => tabs0.find((t) => t.id === id)?.windowId));
  log(`${k}: “${m.name}” spans ${ws.size} window${ws.size === 1 ? '' : 's'}`);
  if (k !== 'shopping') assert.ok(ws.size >= 2, `${k} mission starts spread across windows`);
}
const popupTab = byUrl('https://www.rtings.com/laptop/tests/battery-life');
assert.equal(a.verdicts[popupTab.id], undefined, 'popup-window tabs are left out of analysis');
const groupPlan = a.plan.find((p) => p.kind === 'group-missions');
assert.ok(groupPlan && Object.values(missions).every((m) => groupPlan.missionIds.includes(m.id)), 'plan proposes grouping every mission');

const ids = Object.values(missions).map((m) => m.id);
const total0 = tabs0.length;

// ---------- Gather mode ----------
const r1 = await rpc('groupMissions', { missionIds: ids });
log('gather:', r1.message);
assert.ok(!r1.message.includes("couldn't"), 'no mission failed');
await sleep(500);
let tabs = await allTabs();
let groups = await allGroups();
assert.equal(tabs.length, total0, 'no tab lost or duplicated');
for (const [k, m] of Object.entries(missions)) {
  const mt = tabs.filter((t) => m.tabIds.includes(t.id) && !t.pinned);
  const gids = new Set(mt.map((t) => t.groupId));
  assert.equal(gids.size, 1, `${k}: all tabs in exactly one group`);
  const g = groups.find((x) => x.id === [...gids][0]);
  assert.equal(g?.title, m.name, `${k}: group carries the mission name`);
  assert.equal(new Set(mt.map((t) => t.windowId)).size, 1, `${k}: gathered into one window`);
}
const popupAfter = tabs.find((t) => t.id === popupTab.id);
assert.equal(popupAfter.windowId, win.popup, 'popup window untouched');
const pinnedAfter = tabs.find((t) => t.url === 'https://open.spotify.com/playlist/focus');
assert.ok(pinnedAfter.pinned && pinnedAfter.groupId === -1, 'pinned tab stays pinned and ungrouped');
log('gather mode ✓ — one real Chrome group per mission, tabs gathered from 3 windows');

// The plan must not propose grouping them again.
const a2 = await rpc('analyze', {});
const again = a2.plan.find((p) => p.kind === 'group-missions');
assert.ok(!again || !Object.values(missions).some((m) => again.missionIds.includes(m.id)), 'grouped missions drop out of the plan');

// ---------- Undo puts every tab back in its own window ----------
await rpc('undo', { undoId: r1.undoId });
await sleep(800);
tabs = await allTabs();
// A window emptied by gathering is closed by Chrome; undo recreates it (with a new id). So check that
// tabs which shared a window before share one again, and tabs that didn't, don't.
const winMap = new Map();
for (const t0 of tabs0) {
  const t = tabs.find((x) => x.id === t0.id);
  if (!t) continue;
  if (!winMap.has(t0.windowId)) winMap.set(t0.windowId, t.windowId);
  assert.equal(t.windowId, winMap.get(t0.windowId), `undo returns “${t0.title}” to its window`);
  assert.equal(t.groupId, -1, `undo ungroups “${t0.title}”`);
}
assert.equal(new Set(winMap.values()).size, winMap.size, 'undo keeps windows separate');
log('undo ✓ — every tab back in its own window (recreating emptied windows), ungrouped');
const now = await allTabs();
const remap = (w) => winMap.get(w) ?? w;
for (const t0 of tabs0) t0.windowId = remap(t0.windowId);
win.c = remap(win.c);
win.b = remap(win.b);
void now;

// ---------- Per-window mode ----------
await setSettings({ grouping: { crossWindow: 'per-window' } });
await rpc('analyze', {});
const r2 = await rpc('groupMissions', { missionIds: ids });
log('per-window:', r2.message);
await sleep(500);
tabs = await allTabs();
groups = await allGroups();
for (const t0 of tabs0) {
  const t = tabs.find((x) => x.id === t0.id);
  if (t) assert.equal(t.windowId, t0.windowId, `per-window keeps “${t0.title}” in its window`);
}
for (const [k, m] of Object.entries(missions)) {
  const mt = tabs.filter((t) => m.tabIds.includes(t.id) && !t.pinned);
  for (const t of mt) assert.equal(groups.find((g) => g.id === t.groupId)?.title, m.name, `${k}: “${t.title}” grouped under the mission name`);
  const perWin = new Set(mt.map((t) => t.windowId));
  const mGroups = groups.filter((g) => g.title === m.name);
  assert.equal(mGroups.length, perWin.size, `${k}: one group in each of its ${perWin.size} windows`);
}
log('per-window mode ✓ — same-named group in every window, nothing moved');

// ---------- Auto-sync: a new tab joins its mission's group ----------
{
  const late = await ctx.newPage();
  await late.goto('https://www.laptopmag.com/reviews/lenovo-yoga-7-laptop', { waitUntil: 'domcontentloaded' });
  await ev(async ([w, url]) => {
    const [t] = await chrome.tabs.query({ url });
    await chrome.tabs.move(t.id, { windowId: w, index: -1 });
  }, [win.b, 'https://www.laptopmag.com/reviews/lenovo-yoga-7-laptop']);
}
let joined;
for (let i = 0; i < 30 && !joined; i++) {
  await sleep(1000);
  const t = (await allTabs()).find((x) => x.url === 'https://www.laptopmag.com/reviews/lenovo-yoga-7-laptop');
  const g = (await allGroups()).find((x) => x.id === t?.groupId);
  if (g?.title === missions.laptop.name) joined = { t, g };
}
if (!joined) {
  const a3 = await rpc('analyze', {});
  const t = (await allTabs()).find((x) => x.url === 'https://www.laptopmag.com/reviews/lenovo-yoga-7-laptop');
  log('late tab', t?.id, 'window', t?.windowId, 'group', t?.groupId, 'mission', a3.verdicts[t?.id]?.missionId, '| groups:', JSON.stringify((await allGroups()).map((g) => [g.title, g.windowId])));
}
assert.ok(joined, 'new laptop tab joined the laptop group automatically');
assert.equal(joined.t.windowId, win.b, 'auto-sync grouped it in its own window (per-window mode)');
log('auto-sync ✓ — new tab joined “' + joined.g.title + '” in its window');

if (!process.argv.includes('--no-shots')) {
  await ext.bringToFront();
  await ext.reload();
  await ext.waitForSelector('section[aria-label]');
  await sleep(1200);
  await ext.screenshot({ path: path.join(root, 'docs/screenshots/missions-windows.png') });
  log('shot missions-windows');
}

await ctx.close();
fs.rmSync(userDir, { recursive: true, force: true });
log('all multi-window assertions passed');

/**
 * Multi-window grouping test against the real extension in Firefox (offline, fake pages).
 * The Firefox twin of e2e-windows.mjs: missions are split across three windows, then grouped,
 * undone, grouped per window and auto-synced, checking Firefox's actual tab groups each time.
 *
 * Firefox can't route requests like Playwright, so a tiny local HTTP proxy answers every page.
 *
 *   pnpm build:e2e:firefox && node scripts/e2e-firefox.mjs
 *   FIREFOX_BIN=/path/to/firefox  (default: newest Firefox under ~/.cache/puppeteer/firefox)
 *   Get one with: npx @puppeteer/browsers install firefox@stable --path ~/.cache/puppeteer
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EXT = path.join(root, 'dist-e2e/firefox-mv3');
const GECKO_ID = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).browser_specific_settings.gecko.id;
const UUID = '7ab1e5e0-7ab1-4e5e-8000-000000000001';
const cache = path.join(os.homedir(), '.cache/puppeteer/firefox');
const exe =
  process.env.FIREFOX_BIN ||
  (fs.existsSync(cache) &&
    fs
      .readdirSync(cache)
      .sort()
      .map((d) => path.join(cache, d, 'Firefox.app/Contents/MacOS/firefox'))
      .filter((p) => fs.existsSync(p))
      .pop());
if (!exe) throw new Error('No Firefox found. Run: npx @puppeteer/browsers install firefox@stable --path ~/.cache/puppeteer');
const log = (...a) => console.log('[firefox]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// http:// so the proxy sees plain requests; the analysis doesn't care about the scheme.
const PAGES = {
  'http://www.google.com/search?q=best+laptops+under+80000': ['best laptops under 80000 - Google Search', 'laptop'],
  'http://www.theverge.com/reviews/macbook-air-m4-review': ['MacBook Air M4 review: the best laptop battery life', 'laptop'],
  'http://www.amazon.in/Lenovo-ThinkPad-X1-Carbon-Laptop/dp/B0D1': ['Lenovo ThinkPad X1 Carbon laptop : Amazon.in', 'shopping'],
  'http://www.flipkart.com/asus-zenbook-14-oled-laptop/p/itm7a': ['ASUS Zenbook 14 OLED laptop - Flipkart', 'shopping'],
  'http://www.notebookcheck.net/Dell-XPS-13-laptop-review.html': ['Dell XPS 13 laptop review: battery life and display', 'laptop'],
  'http://github.com/acme/expense-app/pull/42': ['Fix receipt upload on Safari · Pull Request #42 · acme/expense-app', 'repo'],
  'http://github.com/acme/expense-app/issues/17': ['Receipts fail to upload on Safari · Issue #17 · acme/expense-app', 'repo'],
  'http://github.com/acme/expense-app': ['acme/expense-app: Expense tracking for small teams', 'repo'],
  'http://www.booking.com/searchresults.html?ss=Goa': ['Goa hotels: beach hotels in North Goa - Booking.com', 'goa'],
  'http://www.skyscanner.co.in/transport/flights/blr/goi/': ['Cheap flights from Bengaluru to Goa - Skyscanner', 'goa'],
  'http://www.tripadvisor.in/Attractions-Goa.html': ['Things to do in Goa: beaches and forts - Tripadvisor', 'goa'],
  'http://open.spotify.com/playlist/focus': ['Deep Focus – Spotify', 'pinned'],
  'http://www.rtings.com/laptop/tests/battery-life': ['Laptop battery life test - RTINGS', 'popup'],
  'http://www.laptopmag.com/reviews/lenovo-yoga-7-laptop': ['Lenovo Yoga 7 laptop review: battery life tested', 'late'],
  'http://www.laptopmag.com/reviews/hp-spectre-x360-laptop': ['HP Spectre x360 laptop review: battery life tested', 'late'],
  'http://www.laptopmag.com/reviews/acer-swift-go-laptop': ['Acer Swift Go laptop review: battery life tested', 'late'],
};
const html = (title) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${title}"></head><body><h1>${title}</h1>${`<p>${title}. ${title.split(' ').reverse().join(' ')}.</p>`.repeat(8)}</body></html>`;

const W1 = ['http://www.google.com/search?q=best+laptops+under+80000', 'http://www.theverge.com/reviews/macbook-air-m4-review', 'http://github.com/acme/expense-app/pull/42', 'http://www.booking.com/searchresults.html?ss=Goa'];
const W2 = ['http://www.amazon.in/Lenovo-ThinkPad-X1-Carbon-Laptop/dp/B0D1', 'http://www.flipkart.com/asus-zenbook-14-oled-laptop/p/itm7a', 'http://github.com/acme/expense-app/issues/17', 'http://www.skyscanner.co.in/transport/flights/blr/goi/'];
const W3 = ['http://www.notebookcheck.net/Dell-XPS-13-laptop-review.html', 'http://github.com/acme/expense-app', 'http://www.tripadvisor.in/Attractions-Goa.html'];
const PINNED = 'http://open.spotify.com/playlist/focus';
const POPUP = 'http://www.rtings.com/laptop/tests/battery-life';
const LATE = 'http://www.laptopmag.com/reviews/lenovo-yoga-7-laptop';
const LATE_NO = 'http://www.laptopmag.com/reviews/hp-spectre-x360-laptop';
const LATE_AUTO = 'http://www.laptopmag.com/reviews/acer-swift-go-laptop';

// Offline proxy: answers fixture pages, refuses everything else (including https CONNECTs).
const proxy = http.createServer((req, res) => {
  const page = PAGES[req.url];
  if (!page) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html(page[0]));
});
proxy.on('connect', (_req, socket) => socket.destroy());
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const port = proxy.address().port;

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: exe,
  headless: !process.argv.includes('--headed'),
  // Lets WebDriver BiDi script privileged (moz-extension://) pages.
  env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
  extraPrefsFirefox: {
    // A fixed moz-extension:// UUID so the test can open the dashboard.
    'extensions.webextensions.uuids': JSON.stringify({ [GECKO_ID]: UUID }),
    // MV3 host permissions granted at install, as the e2e build lists them.
    'extensions.originControls.grantByDefault': true,
    'network.proxy.type': 1,
    'network.proxy.http': '127.0.0.1',
    'network.proxy.http_port': port,
    'network.proxy.ssl': '127.0.0.1',
    'network.proxy.ssl_port': port,
    'network.proxy.no_proxies_on': '',
    'network.proxy.allow_hijacking_localhost': true,
    // Keep fixture hosts on plain http (github.com etc. are HSTS-preloaded).
    'network.stricttransportsecurity.preloadlist': false,
    'dom.security.https_first': false,
    'dom.security.https_only_mode': false,
  },
});

try {
  const extId = await browser.installExtension(EXT);
  log('installed', extId, 'Firefox', await browser.version());
  await sleep(1500);
  const base = `moz-extension://${UUID}`;

  // BiDi doesn't report navigations to moz-extension:// pages, so drive the test from the welcome
  // tab TabLens opens on install, open other extension pages with chrome.tabs.create, and find
  // them by asking each page where it is.
  const hrefOf = (p) => p.evaluate(() => location.href).catch(() => '');
  const findPage = async (match, tries = 120) => {
    for (let i = 0; i < tries; i++) {
      for (const p of await browser.pages()) {
        const href = await hrefOf(p);
        if (href.startsWith(base) && match(href)) return p;
      }
      await sleep(250);
    }
    throw new Error('extension page did not open');
  };
  let ext = await findPage((u) => u.includes('dashboard.html'), 40).catch(() => null);
  if (!ext) {
    // No welcome tab yet (slow machine): navigate a fresh tab. BiDi never reports that load, so
    // don't wait on it; findPage confirms the page is there.
    await (await browser.newPage()).goto(`${base}/dashboard.html#/missions`, { timeout: 2000 }).catch(() => {});
    ext = await findPage((u) => u.includes('dashboard.html'));
  }
  await ext.evaluate(() => (location.hash = '#/missions'));
  const openExtPage = async (page) => {
    await ext.evaluate((url) => chrome.tabs.create({ url: chrome.runtime.getURL(url), active: false }), page);
    return findPage((u) => u.endsWith('/' + page));
  };
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

  assert.ok(await ev(() => typeof chrome.tabGroups?.query === 'function'), 'Firefox exposes the tabGroups API');
  assert.ok(await ev(() => chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] })), 'page access granted');

  for (const url of [...W1, ...W2, ...W3, PINNED, POPUP]) {
    const p = await browser.newPage();
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
    [W1, W2, W3, PINNED, POPUP],
  );
  log('windows', JSON.stringify(win));
  await sleep(1500);

  const snaps = await ev(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open('tablens');
      r.onsuccess = () => res(r.result);
    });
    return new Promise((res) => {
      const c = db.transaction('snapshots').objectStore('snapshots').count();
      c.onsuccess = () => res(c.result);
    });
  });
  log('snapshots captured:', snaps);
  assert.ok(snaps >= 10, 'content script captured page snapshots');

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
  await setSettings({ installedAt: Date.now() - 20 * 86_400_000, onboarded: true, grouping: { crossWindow: 'gather', newTabs: 'auto' } });

  const a = await rpc('analyze', { fresh: true });
  let tabs = await allTabs();
  const tabs0 = tabs.map((t) => ({ id: t.id, windowId: t.windowId, title: t.title, url: t.url }));
  const missions = {};
  for (const kind of ['laptop', 'repo', 'goa']) {
    const ids = tabs.filter((t) => PAGES[t.url]?.[1] === kind).map((t) => t.id);
    const m = a.missions.find((x) => ids.every((id) => x.tabIds.includes(id)));
    assert.ok(m, `one mission holds every ${kind} tab (got ${ids.map((id) => a.verdicts[id]?.missionId).join(', ')})`);
    missions[kind] = m;
  }
  log('missions:', a.missions.map((m) => `${m.name} (${m.tabIds.length})`).join(' | '));
  const popupTab = tabs.find((t) => t.url === POPUP);
  assert.equal(a.verdicts[popupTab.id], undefined, 'popup-window tabs are left out of analysis');
  const ids = Object.values(missions).map((m) => m.id);

  // ---------- Gather mode ----------
  const r1 = await rpc('groupMissions', { missionIds: ids });
  log('gather:', r1.message);
  assert.ok(!r1.message.includes("couldn't"), 'no mission failed');
  await sleep(500);
  tabs = await allTabs();
  let groups = await allGroups();
  assert.equal(tabs.length, tabs0.length, 'no tab lost or duplicated');
  for (const [k, m] of Object.entries(missions)) {
    const mt = tabs.filter((t) => m.tabIds.includes(t.id) && !t.pinned);
    const gids = new Set(mt.map((t) => t.groupId));
    assert.equal(gids.size, 1, `${k}: all tabs in exactly one group`);
    const g = groups.find((x) => x.id === [...gids][0]);
    assert.equal(g?.title, m.name, `${k}: group carries the mission name`);
    assert.equal(new Set(mt.map((t) => t.windowId)).size, 1, `${k}: gathered into one window`);
  }
  assert.equal(tabs.find((t) => t.url === POPUP).windowId, win.popup, 'popup window untouched');
  const pinnedAfter = tabs.find((t) => t.url === PINNED);
  assert.ok(pinnedAfter.pinned && pinnedAfter.groupId === -1, 'pinned tab stays pinned and ungrouped');
  log('gather mode ✓ — one real Firefox tab group per mission, tabs gathered from 3 windows');

  // ---------- Undo ----------
  await rpc('undo', { undoId: r1.undoId });
  await sleep(800);
  tabs = await allTabs();
  const winMap = new Map();
  for (const t0 of tabs0) {
    const t = tabs.find((x) => x.id === t0.id);
    if (!t || !PAGES[t0.url] || t0.url === POPUP) continue;
    if (!winMap.has(t0.windowId)) winMap.set(t0.windowId, t.windowId);
    assert.equal(t.windowId, winMap.get(t0.windowId), `undo returns “${t0.title}” to its window`);
    assert.equal(t.groupId, -1, `undo ungroups “${t0.title}”`);
  }
  assert.equal(new Set(winMap.values()).size, winMap.size, 'undo keeps windows separate');
  log('undo ✓ — every tab back in its own window, ungrouped');
  for (const t0 of tabs0) t0.windowId = winMap.get(t0.windowId) ?? t0.windowId;
  win.b = winMap.get(win.b) ?? win.b;

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
    assert.equal(groups.filter((g) => g.title === m.name).length, perWin.size, `${k}: one group in each of its ${perWin.size} windows`);
  }
  log('per-window mode ✓ — same-named group in every window, nothing moved');

  // ---------- New tabs that fit a group: ask first (default), a No sticks, automatic on request ----------
  {
    const lateTab = async (url) => {
      await (await browser.newPage()).goto(url, { waitUntil: 'domcontentloaded' });
      // Into window B, in front, so it is the tab the user is looking at.
      await ev(async ([w, url]) => {
        const [t] = await chrome.tabs.query({ url });
        await chrome.tabs.move(t.id, { windowId: w, index: -1 });
        await chrome.tabs.update(t.id, { active: true });
        await chrome.windows.update(w, { focused: true });
      }, [win.b, url]);
      return (await allTabs()).find((x) => x.url === url);
    };
    const groupTitleOf = async (url) => {
      const t = (await allTabs()).find((x) => x.url === url);
      return (await allGroups()).find((g) => g.id === t?.groupId)?.title;
    };
    const chipShown = async (url) => {
      for (const p of await browser.pages()) if ((await hrefOf(p)) === url) return !!(await p.$('#tablens-join'));
      return false;
    };

    await setSettings({ grouping: { newTabs: 'ask' } });
    const yes = await lateTab(LATE);
    // The prompt follows the analysis that runs once the page has been read (a few seconds).
    let shown = false;
    for (let i = 0; i < 20 && !shown; i++) {
      await sleep(1000);
      shown = await chipShown(LATE);
    }
    assert.ok(shown, 'ask mode: the “add to group?” prompt is shown on the tab');
    assert.equal(await groupTitleOf(LATE), undefined, 'ask mode: a new tab is not moved or grouped on its own');
    const r = await rpc('answerJoin', { tabId: yes.id, group: missions.laptop.name, accept: true });
    assert.ok(r.joined, 'yes: tab joins');
    assert.equal(await groupTitleOf(LATE), missions.laptop.name, 'yes: tab is in the mission’s group');

    const no = await lateTab(LATE_NO);
    for (let i = 0; i < 20 && !(await chipShown(LATE_NO)); i++) await sleep(1000);
    assert.equal(await groupTitleOf(LATE_NO), undefined, 'ask mode: second tab waits for an answer');
    await rpc('answerJoin', { tabId: no.id, group: missions.laptop.name, accept: false });
    // A No sticks: clear the prompt, come back to the tab, and it isn't asked again.
    for (const p of await browser.pages()) if ((await hrefOf(p)) === LATE_NO) await p.evaluate(() => document.getElementById('tablens-join')?.remove());
    await ev(async ([url, w]) => {
      const [t] = await chrome.tabs.query({ url });
      const [other] = (await chrome.tabs.query({ windowId: w })).filter((x) => x.id !== t.id);
      await chrome.tabs.update(other.id, { active: true });
      await chrome.tabs.update(t.id, { active: true });
    }, [LATE_NO, win.b]);
    await sleep(5000);
    assert.ok(!(await chipShown(LATE_NO)), 'no: not asked again for the same tab and group');
    assert.equal(await groupTitleOf(LATE_NO), undefined, 'no: tab stays where it is');
    log('ask ✓ — tabs stay put until answered; yes joins, no is remembered');

    await setSettings({ grouping: { newTabs: 'auto' } });
    await lateTab(LATE_AUTO);
    let joined;
    for (let i = 0; i < 30 && !joined; i++) {
      await sleep(1000);
      if ((await groupTitleOf(LATE_AUTO)) === missions.laptop.name) joined = (await allTabs()).find((x) => x.url === LATE_AUTO);
    }
    assert.ok(joined, 'automatic: new laptop tab joined the laptop group');
    assert.equal(joined.windowId, win.b, 'automatic: grouped in its own window (per-window mode)');
    assert.equal(await groupTitleOf(LATE_NO), undefined, 'automatic mode still respects a No for that tab and group');
    log('automatic ✓ — new tab joined “' + missions.laptop.name + '”; the tab you said no to stayed out');
  }

  // Firefox-only surfaces load without errors.
  for (const page of ['popup.html', 'sidepanel.html', 'dashboard.html#/settings']) {
    const p = await openExtPage(page);
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await p.evaluate(() => location.reload());
    await sleep(2000);
    const text = await p.evaluate(() => document.body.innerText);
    assert.ok(text.trim().length > 20, `${page} renders`);
    assert.deepEqual(errors, [], `${page} has no errors`);
    await p.close();
  }
  log('popup, sidebar and settings render ✓');

  if (process.env.FF_SCREENSHOT) {
    // BiDi can't set a viewport on an extension page; size its window instead.
    await ext.evaluate(async () => {
      const w = await chrome.windows.getCurrent();
      await chrome.windows.update(w.id, { width: 1440, height: 1000, focused: true });
      const t = await chrome.tabs.getCurrent();
      await chrome.tabs.update(t.id, { active: true });
      location.reload();
    });
    await sleep(2500);
    await ext.screenshot({ path: process.env.FF_SCREENSHOT });
    log('screenshot', process.env.FF_SCREENSHOT);
  }

  log('all Firefox assertions passed');
} finally {
  await browser.close();
  proxy.close();
}

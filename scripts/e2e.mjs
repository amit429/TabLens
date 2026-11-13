/**
 * End-to-end run of the real extension in Chromium, fully offline:
 * every http(s) request is answered with a fake page from FIXTURES. It opens ~25 tabs,
 * simulates reading/typing, ages some tabs, runs an analysis, exercises the executor
 * (group, move, archive, undo) and screenshots every surface into docs/screenshots.
 *
 *   TABLENS_E2E=1 pnpm build && node scripts/e2e.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EXT = path.join(root, '.output-e2e/chrome-mv3');
const OUT = path.join(root, 'docs/screenshots');
const SHOTS = !process.argv.includes('--no-shots');
const DARK = process.argv.includes('--dark');
fs.mkdirSync(OUT, { recursive: true });

const exe =
  process.env.CHROME_BIN ||
  fs
    .readdirSync(path.join(os.homedir(), 'Library/Caches/ms-playwright'))
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .map((d) => path.join(os.homedir(), 'Library/Caches/ms-playwright', d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
    .filter((p) => fs.existsSync(p))
    .pop();

const lorem = (topic, n = 8) =>
  Array.from({ length: n }, (_, i) => `<p>${topic} ${['matters because', 'is compared here with', 'was tested over two weeks against', 'comes down to', 'changes how you think about'][i % 5]} ${topic.split(' ').reverse().join(' ')}. ${'We looked at real-world numbers, day-to-day use and the trade-offs that matter when you finally decide. '.repeat(3)}</p>`).join('\n');

// [url, title, days since last use, options]
const FIXTURES = [
  ['https://www.google.com/search?q=best+laptops+under+80000', 'best laptops under 80000 - Google Search', 5, { type: 'search' }],
  ['https://www.theverge.com/reviews/macbook-air-m4-review', 'MacBook Air M4 review: the best laptop for most people', 4, { article: 'MacBook Air M4 laptop battery life', scroll: 0.95, active: 420 }],
  ['https://www.amazon.in/Lenovo-ThinkPad-X1-Carbon-Laptop/dp/B0D1', 'Lenovo ThinkPad X1 Carbon Gen 12 Laptop, Intel Core Ultra 7 : Amazon.in', 9, { product: 'ThinkPad X1 Carbon laptop', active: 3 }],
  ['https://www.flipkart.com/asus-zenbook-14-oled-laptop/p/itm7a', 'ASUS Zenbook 14 OLED Laptop (16GB/1TB) - Flipkart', 9, { product: 'Zenbook 14 OLED laptop', active: 2 }],
  ['https://www.notebookcheck.net/Dell-XPS-13-9350-laptop-review.html', 'Dell XPS 13 9350 laptop review: battery life and display tested', 6, { article: 'Dell XPS 13 laptop battery display', scroll: 0.5, active: 120 }],
  ['https://www.rtings.com/laptop/tests/battery-life', 'Laptop battery life test: which laptops last longest - RTINGS.com', 8, { article: 'laptop battery life test', active: 4 }],
  ['https://github.com/acme/expense-app/pull/42', 'Fix receipt upload on Safari by priya · Pull Request #42 · acme/expense-app', 0.05, { active: 900, scroll: 0.6 }],
  ['https://github.com/acme/expense-app/issues/17', 'Receipts fail to upload on Safari 18 · Issue #17 · acme/expense-app', 1.2, { active: 200 }],
  ['https://github.com/acme/expense-app', 'acme/expense-app: Expense tracking for small teams', 2, {}],
  ['https://linear.app/acme/issue/EXP-88/receipt-ocr-fails-on-rotated-images', 'EXP-88 Receipt OCR fails on rotated images', 0.3, {}],
  ['https://stackoverflow.com/questions/7712/safari-formdata-file-upload-fails', 'javascript - Safari FormData file upload fails with empty body - Stack Overflow', 1.5, { article: 'Safari FormData file upload receipt', scroll: 0.9 }],
  ['https://developer.mozilla.org/en-US/docs/Web/API/FormData', 'FormData - Web APIs | MDN', 10, { article: 'FormData web API append file upload', active: 5 }],
  ['https://arxiv.org/abs/1706.03762', 'Attention Is All You Need: transformer architecture paper', 2, { article: 'attention transformer encoder decoder', scroll: 0.46, active: 600 }],
  ['https://jalammar.github.io/illustrated-transformer/', 'The Illustrated Transformer: attention and self-attention visualized', 3.5, { article: 'transformer self-attention illustrated', scroll: 1, active: 700 }],
  ['https://huggingface.co/docs/transformers/index', 'Transformers documentation: pretrained attention models', 12, { article: 'transformers pretrained models attention', active: 2 }],
  ['https://www.booking.com/searchresults.html?ss=Goa', 'Goa hotels: best beach hotels in North Goa - Booking.com', 1, { active: 240 }],
  ['https://www.skyscanner.co.in/transport/flights/blr/goi/', 'Cheap flights from Bengaluru to Goa - Skyscanner', 1, { active: 120 }],
  ['https://www.tripadvisor.in/Attractions-g297604-Activities-Goa.html', 'Things to do in Goa: beaches, forts and trip ideas - Tripadvisor', 2.5, { article: 'Goa trip beaches things to do', scroll: 0.3 }],
  ['https://visa.example.gov/apply/form', 'Visa application form — Schengen short stay', 2, { form: true }],
  ['https://www.theverge.com/reviews/macbook-air-m4-review?utm_source=twitter&utm_medium=social', 'MacBook Air M4 review: the best laptop for most people', 8, { article: 'MacBook Air M4 laptop battery life' }],
  ['https://news.ycombinator.com/', 'Hacker News', 13, { active: 6 }],
  ['https://www.reddit.com/r/MechanicalKeyboards/', 'r/MechanicalKeyboards — the home of mechanical keyboards', 15, {}],
  ['https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ', 'Deep Focus – Spotify playlist', 0.01, { pin: true }],
  ['https://docs.google.com/document/d/1xQ4/edit', 'Expense app Q4 roadmap - Google Docs', 0.5, {}],
];

function page(url, title, opts) {
  const head = `<title>${title}</title><meta name="description" content="${title}. ${opts.article ?? opts.product ?? ''}">`;
  const style = `<style>body{font:16px/1.6 Georgia,serif;max-width:720px;margin:40px auto;padding:0 20px;color:#222}</style>`;
  let body = `<h1>${title}</h1>`;
  if (opts.product)
    body += `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"${opts.product}"}</script><h2>Specifications</h2>${lorem(opts.product, 4)}<h2>Reviews</h2>${lorem(opts.product + ' reviews', 6)}`;
  else if (opts.form)
    body += `<form><label>Full name <input name="name"></label><label>Passport number <input name="passport"></label><label>Travel date <input name="date" type="date"></label><label>Purpose <textarea name="purpose"></textarea></label><button>Submit</button></form>${lorem('visa application', 2)}`;
  else if (opts.article) body += `<article><h2>Overview</h2>${lorem(opts.article, 6)}<h2>Details</h2>${lorem(opts.article, 8)}<h2>Verdict</h2>${lorem(opts.article, 6)}</article>`;
  else body += lorem(title, 10);
  return `<!doctype html><html><head><meta charset="utf-8">${head}${style}</head><body>${body}</body></html>`;
}

const log = (...a) => console.log('[e2e]', ...a);

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tablens-e2e-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  executablePath: exe,
  headless: !process.argv.includes('--headed'),
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 2,
  colorScheme: DARK ? 'dark' : 'light',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run'],
});

await ctx.route(/^https?:\/\//, (route) => {
  const url = route.request().url();
  if (process.env.TABLENS_API && url.startsWith(process.env.TABLENS_API)) return route.continue();
  const f = FIXTURES.find(([u]) => url.split('#')[0] === u);
  if (route.request().resourceType() !== 'document') return route.fulfill({ status: 404, body: '' });
  const [u, title, , opts] = f ?? [url, 'Page', 0, {}];
  return route.fulfill({ status: 200, contentType: 'text/html', body: page(u, title, opts) });
});

let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const extId = new URL(sw.url()).host;
log('extension', extId);
const base = `chrome-extension://${extId}`;

// The welcome tab opens on install; keep a handle to it for the onboarding screenshot.
await new Promise((r) => setTimeout(r, 1500));
let welcome = ctx.pages().find((p) => p.url().includes('welcome'));

// Open the fixture tabs.
const pages = [];
for (const [url, , , opts] of FIXTURES) {
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  pages.push({ p, url, opts });
}
log('opened', pages.length, 'tabs');
await new Promise((r) => setTimeout(r, 4000)); // snapshots run on idle

// Simulate behaviour: visit, scroll, type into the form.
for (const { p, opts } of pages) {
  await p.bringToFront();
  if (opts.scroll) {
    await p.evaluate((f) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), opts.scroll);
    await p.mouse.wheel(0, 1);
  }
  if (opts.form) {
    await p.fill('input[name=name]', 'A. Traveller');
  }
  await new Promise((r) => setTimeout(r, 350));
}
await new Promise((r) => setTimeout(r, 2000));

const ext = await ctx.newPage();
await ext.goto(`${base}/dashboard.html#/overview`);
const rpc = (type, payload = {}) =>
  ext.evaluate(async ([type, payload]) => {
    const r = await chrome.runtime.sendMessage({ __tablens: true, type, payload });
    if (!r?.ok) throw new Error(r?.error ?? 'no reply');
    return r.data;
  }, [type, payload]);

// Pin and "play audio" can't be faked via routes; pin the music tab for a protected example.
await ext.evaluate(async () => {
  const [t] = await chrome.tabs.query({ url: 'https://open.spotify.com/*' });
  if (t) await chrome.tabs.update(t.id, { pinned: true });
});

// Age the behaviour records so states differ, and make install date older than the no-history window.
await ext.evaluate(async (fixtures) => {
  const now = Date.now();
  const tabs = await chrome.tabs.query({});
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('tablens');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = db.transaction('tabs', 'readwrite');
  const store = tx.objectStore('tabs');
  for (const t of tabs) {
    const f = fixtures.find(([u]) => u === t.url);
    if (!f) continue;
    const [, , days, opts] = f;
    const rec = await new Promise((res) => {
      const g = store.get(t.id);
      g.onsuccess = () => res(g.result);
    });
    if (!rec) continue;
    const last = now - days * 86_400_000;
    rec.lastAccessed = last;
    rec.openedAt = last - 86_400_000 * (1 + (days % 3));
    rec.activeMs = (opts.active ?? 30) * 1000;
    rec.activations = Math.max(1, Math.round((opts.active ?? 30) / 60));
    rec.visits = Array.from({ length: rec.activations }, (_, i) => last - i * 86_400_000 * 0.7).reverse();
    rec.hasHistory = true;
    store.put(rec);
  }
  await new Promise((r) => (tx.oncomplete = r));
  const s = (await chrome.storage.local.get('settings')).settings ?? {};
  await chrome.storage.local.set({ settings: { ...s, installedAt: now - 20 * 86_400_000, onboarded: true } });
}, FIXTURES);

// ---- Assertions on the real pipeline ----
const a = await rpc('analyze', { fresh: true });
const byTitle = (prefix) => Object.values(a.verdicts).find((v) => FIXTURES.find(([, t]) => t.startsWith(prefix)) && v) && Object.values(a.verdicts);
const tabsNow = await ext.evaluate(() => chrome.tabs.query({}));
const vOf = (prefix) => {
  const t = tabsNow.find((x) => (x.title ?? '').startsWith(prefix));
  return t && a.verdicts[t.id];
};
const missionOf = (prefix) => vOf(prefix)?.missionId;
log('missions:', a.missions.map((m) => `${m.name} (${m.tabIds.length})`).join(' | '));
log('counts:', JSON.stringify(a.counts));
if (process.argv.includes('--debug')) for (const t of tabsNow) { const v = a.verdicts[t.id]; if (v) log((t.title ?? '').slice(0, 40), '|', t.openerTabId, '|', v.evidence.map((e) => e.text).join(' / ')); }
assert.equal(vOf('Visa application')?.state, 'unfinished', 'form tab should be unfinished');
assert.equal(vOf('Attention Is All')?.state, 'unfinished', 'half-read paper should be unfinished');
assert.equal(vOf('Deep Focus')?.state, 'protected', 'pinned tab should be protected');
assert.ok(['abandoned', 'stale'].includes(vOf('Lenovo ThinkPad')?.state), 'old product page should be stale/abandoned');
assert.equal(missionOf('Fix receipt upload'), missionOf('Receipts fail'), 'repo tabs share a mission');
assert.equal(missionOf('Lenovo ThinkPad'), missionOf('ASUS Zenbook'), 'laptop products share a mission');
assert.notEqual(missionOf('Fix receipt upload'), missionOf('ASUS Zenbook'), 'work and shopping are separate');
assert.ok(Object.values(a.verdicts).some((v) => v.state === 'duplicate'), 'a duplicate is detected');
const snapCount = await ext.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('tablens');
    r.onsuccess = () => res(r.result);
  });
  return new Promise((res) => {
    const c = db.transaction('snapshots').objectStore('snapshots').count();
    c.onsuccess = () => res(c.result);
  });
});
log('snapshots captured:', snapCount);
assert.ok(snapCount >= 15, 'content script captured snapshots');
const formRec = await ext.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('tablens');
    r.onsuccess = () => res(r.result);
  });
  const all = await new Promise((res) => {
    const g = db.transaction('tabs').objectStore('tabs').getAll();
    g.onsuccess = () => res(g.result);
  });
  return all.find((r) => r.url.includes('visa.example.gov'));
});
assert.equal(formRec.formStarted, true, 'form-started flag recorded');
assert.ok(!JSON.stringify(formRec).includes('Traveller'), 'form values are never stored');
log('form flag stored without values ✓');

// Executor: group a mission, then undo.
const repoMission = a.missions.find((m) => m.id === missionOf('Fix receipt upload'));
const g = await rpc('groupMissions', { missionIds: [repoMission.id] });
const groups = await ext.evaluate(() => chrome.tabGroups.query({}));
assert.ok(groups.some((x) => x.title === repoMission.name), 'Chrome group created with mission name');
log('grouped', g.message);

// Drag-and-drop equivalent: move the MDN tab into the repo mission.
const mdn = tabsNow.find((t) => t.title.startsWith('FormData - Web APIs'));
await rpc('moveTabToMission', { tabId: mdn.id, missionId: repoMission.id });
const mdnAfter = await ext.evaluate((id) => chrome.tabs.get(id), mdn.id);
const repoGroup = (await ext.evaluate(() => chrome.tabGroups.query({}))).find((x) => x.title === repoMission.name);
assert.equal(mdnAfter.groupId, repoGroup.id, 'moved tab joins the mission group');
const rules = await ext.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('tablens');
    r.onsuccess = () => res(r.result);
  });
  return new Promise((res) => {
    const g = db.transaction('rules').objectStore('rules').getAll();
    g.onsuccess = () => res(g.result);
  });
});
assert.ok(rules.some((r) => r.pattern.includes('developer.mozilla.org')), 'move stored as a rule');
log('move → real tab group + rule ✓');

// Archive + undo.
const hn = tabsNow.find((t) => t.title === 'Hacker News');
const arch = await rpc('archiveTabs', { tabIds: [hn.id] });
assert.ok(!(await ext.evaluate(() => chrome.tabs.query({}))).some((t) => t.url === 'https://news.ycombinator.com/'), 'archived tab closed');
await rpc('undo', { undoId: arch.undoId });
await new Promise((r) => setTimeout(r, 800));
assert.ok((await ext.evaluate(() => chrome.tabs.query({}))).some((t) => t.url === 'https://news.ycombinator.com/'), 'undo reopened the tab');
log('archive + undo ✓');

// Archive a couple for the Archive screenshot, snooze one.
const reddit = tabsNow.find((t) => t.title.startsWith('r/Mechanical'));
await rpc('archiveTabs', { tabIds: [reddit.id] });
const rt = tabsNow.find((t) => t.title.startsWith('Laptop battery life test'));
await rpc('snoozeTabs', { tabIds: [rt.id], until: Date.now() + 2 * 86_400_000 });

// Library: bookmarks + saves with intents.
await ext.evaluate(async () => {
  const folder = await chrome.bookmarks.create({ title: 'Research' });
  const items = [
    ['Designing Data-Intensive Applications — notes', 'https://dataintensive.net/'],
    ['Postgres indexing explained', 'https://use-the-index-luke.com/'],
    ['Rust async book', 'https://rust-lang.github.io/async-book/'],
    ['Tokio tutorial: async Rust', 'https://tokio.rs/tokio/tutorial'],
    ['Linear method: building product', 'https://linear.app/method'],
    ['Pasta carbonara the Roman way', 'https://www.seriouseats.com/pasta-carbonara-recipe'],
    ['Neapolitan pizza dough recipe', 'https://www.seriouseats.com/neapolitan-pizza-dough'],
    ['Refactoring UI', 'https://www.refactoringui.com/'],
    ['Inter typeface specimen', 'https://rsms.me/inter/'],
  ];
  for (const [title, url] of items) await chrome.bookmarks.create({ parentId: folder.id, title, url });
  await chrome.bookmarks.create({ title: 'Rust async book', url: 'https://rust-lang.github.io/async-book/' });
});
await rpc('saveForLater', { url: 'https://www.theverge.com/reviews/macbook-air-m4-review', title: 'MacBook Air M4 review: the best laptop for most people', intent: 'buy', note: 'Compare battery life with the ThinkPad before Friday', remindAt: Date.now() + 3 * 86_400_000 });
await rpc('saveForLater', { url: 'https://jalammar.github.io/illustrated-transformer/', title: 'The Illustrated Transformer', intent: 'reference', note: 'Best diagram of multi-head attention' });
await rpc('saveForLater', { url: 'https://www.youtube.com/watch?v=kCc8FmEb1nY', title: "Let's build GPT: from scratch, in code, spelled out", intent: 'watch', note: '' });

await rpc('analyze', {});

// TabLens AI wiring (run with TABLENS_API=http://localhost:8787 and `pnpm --dir server dev`).
if (process.env.TABLENS_API) {
  await ext.evaluate(async () => {
    const s = (await chrome.storage.local.get('settings')).settings ?? {};
    await chrome.storage.local.set({ settings: { ...s, ai: { ...(s.ai ?? {}), mode: 'cloud', cloudConsent: true } } });
  });
  const st = await rpc('cloudStatus');
  log('cloud status:', JSON.stringify(st));
  assert.equal(st.ok, true, 'extension reaches TabLens AI through origin check, CORS and install id');
  assert.ok(st.quota && st.quota.naming.limit > 0, 'quota reported');
  const fresh = await rpc('analyze', { fresh: true });
  log('analysis engine with cloud on:', fresh.engine, '| missions:', fresh.missions.length);
  if (process.env.TABLENS_EXPECT_GEMINI) {
    assert.equal(fresh.engine, 'cloud', 'Gemini organised the missions');
    assert.ok(fresh.missions.some((m) => m.source === 'model'), 'missions come from the model');
    log('AI missions:', fresh.missions.map((m) => `${m.name} (${m.tabIds.length})`).join(' | '));
    // Missions the user grouped in Chrome earlier in this run stay theirs.
    assert.ok(fresh.missions.some((m) => (m.source === 'user' || m.source === 'rule') && !m.name.startsWith('Mock:')), 'user-owned mission kept as fixed');
  }
  else assert.ok(fresh.missions.length > 1, 'falls back to heuristic names when Gemini fails');
}
log('all assertions passed');

if (SHOTS) {
  const suffix = DARK ? '-dark' : '';
  const shot = async (p, name, opts = {}) => {
    await new Promise((r) => setTimeout(r, 900));
    await p.screenshot({ path: path.join(OUT, `${name}${suffix}.png`), ...opts });
    log('shot', name + suffix);
  };
  // Popup as a page at its real size.
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 400, height: 640 });
  await popup.goto(`${base}/popup.html`);
  await popup.waitForSelector('text=Cleanup plan');
  await popup.locator('button[aria-expanded]').nth(1).click().catch(() => {});
  await shot(popup, 'popup');

  await ext.bringToFront();
  await ext.goto(`${base}/dashboard.html#/overview`);
  await ext.waitForSelector('text=Cleanup plan');
  await shot(ext, 'overview');

  await ext.goto(`${base}/dashboard.html#/missions`);
  await ext.waitForSelector('section[aria-label]');
  await shot(ext, 'missions');

  await ext.locator('section[aria-label] li [role=button]').first().click();
  await ext.waitForSelector('text=What you did');
  await shot(ext, 'dossier');
  await ext.keyboard.press('Escape');

  await ext.goto(`${base}/dashboard.html#/library`);
  await ext.waitForSelector('text=By topic');
  await shot(ext, 'library');

  await ext.goto(`${base}/dashboard.html#/archive`);
  await shot(ext, 'archive');

  await ext.goto(`${base}/dashboard.html#/settings`);
  await ext.waitForSelector('text=Engagement weights');
  await shot(ext, 'settings');
  await ext.getByText('TabLens AI (Gemini, hosted by TabLens)').scrollIntoViewIfNeeded();
  await shot(ext, 'settings-ai');

  await ext.goto(`${base}/dashboard.html#/missions`);
  await ext.keyboard.press('Meta+k');
  await ext.keyboard.type('attention');
  await shot(ext, 'quick-find');
  await ext.keyboard.press('Escape');

  const side = await ctx.newPage();
  await side.setViewportSize({ width: 380, height: 800 });
  await side.goto(`${base}/sidepanel.html`);
  await side.getByRole('tab', { name: 'Missions' }).click();
  await shot(side, 'sidepanel');

  welcome ??= await ctx.newPage();
  await welcome.goto(`${base}/dashboard.html#/welcome`);
  await welcome.waitForSelector('text=tabs open across');
  await shot(welcome, 'welcome');
}

await ctx.close();
fs.rmSync(userDir, { recursive: true, force: true });
log('done');

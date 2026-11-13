import { db, uid } from './db';
import type { Save, SaveIntent } from './types';
import { normalizeUrl } from './url';
import { tfidf, tokenize, centroid, cosine, topTerms, stem } from './text';

const sentence = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
import { pathWords, siteOf } from './url';

export const INTENTS: { id: SaveIntent; label: string; hint: string }[] = [
  { id: 'read', label: 'Read later', hint: 'An article or doc to get back to' },
  { id: 'buy', label: 'Buy', hint: 'Something you might purchase' },
  { id: 'reference', label: 'Reference', hint: 'You will look this up again' },
  { id: 'watch', label: 'Watch', hint: 'A video or talk' },
  { id: 'todo', label: 'To do', hint: 'Something you need to act on' },
  { id: 'inspiration', label: 'Inspiration', hint: 'Ideas, design, things you liked' },
];

export const SAVES_FOLDER = 'TabLens saves';

export async function hasBookmarks(): Promise<boolean> {
  return chrome.permissions.contains({ permissions: ['bookmarks'] });
}

async function savesFolderId(): Promise<string | undefined> {
  if (!(await hasBookmarks())) return undefined;
  const found = await chrome.bookmarks.search({ title: SAVES_FOLDER });
  const folder = found.find((b) => !b.url);
  if (folder) return folder.id;
  const created = await chrome.bookmarks.create({ title: SAVES_FOLDER });
  return created.id;
}

/** Saves a page with an intent and note. Mirrored to a bookmarks folder so saves outlive the extension. */
export async function saveForLater(s: { url: string; title: string; favIconUrl?: string; intent: SaveIntent; note: string; remindAt?: number }): Promise<Save> {
  const existing = (await db.saves.where('url').equals(s.url).toArray())[0];
  const folder = await savesFolderId();
  let bookmarkId = existing?.bookmarkId;
  if (folder && !bookmarkId) bookmarkId = (await chrome.bookmarks.create({ parentId: folder, title: s.title, url: s.url })).id;
  const save: Save = {
    id: existing?.id ?? uid('s'),
    url: s.url,
    title: s.title,
    favIconUrl: s.favIconUrl,
    intent: s.intent,
    note: s.note,
    remindAt: s.remindAt,
    bookmarkId,
    createdAt: existing?.createdAt ?? Date.now(),
    lastSeenAt: existing?.lastSeenAt ?? Date.now(),
  };
  await db.saves.put(save);
  if (bookmarkId) await db.bookmarkMeta.put({ bookmarkId, intent: s.intent, note: s.note, lastSeenAt: save.lastSeenAt });
  if (s.remindAt) await chrome.alarms.create(`remind:${save.id}`, { when: s.remindAt });
  return save;
}

/** Marks saves and bookmarks for this URL as seen now; called when a tab is visited. */
export async function touchSeen(url: string) {
  const norm = normalizeUrl(url);
  const now = Date.now();
  const saves = await db.saves.toArray();
  const hits = saves.filter((s) => normalizeUrl(s.url) === norm);
  if (hits.length) await db.saves.bulkPut(hits.map((s) => ({ ...s, lastSeenAt: now })));
  if (await hasBookmarks()) {
    const marks = await chrome.bookmarks.search({ url }).catch(() => []);
    for (const b of marks) {
      const m = await db.bookmarkMeta.get(b.id);
      await db.bookmarkMeta.put({ ...(m ?? { bookmarkId: b.id }), lastSeenAt: now });
    }
  }
}

export interface LibraryItem {
  key: string;
  bookmarkId?: string;
  saveId?: string;
  url: string;
  title: string;
  folder: string;
  addedAt?: number;
  /** Most recent of Chrome's dateLastUsed and TabLens's own visit tracking. */
  lastSeenAt?: number;
  intent?: SaveIntent;
  note?: string;
  remindAt?: number;
  duplicate: boolean;
}

/** Merges Chrome bookmarks, TabLens saves and per-bookmark notes into one list. */
export async function loadLibrary(): Promise<LibraryItem[]> {
  const [saves, metas] = await Promise.all([db.saves.toArray(), db.bookmarkMeta.toArray()]);
  const metaById = new Map(metas.map((m) => [m.bookmarkId, m]));
  const saveByBookmark = new Map(saves.filter((s) => s.bookmarkId).map((s) => [s.bookmarkId!, s]));
  const items: LibraryItem[] = [];

  if (await hasBookmarks()) {
    const tree = await chrome.bookmarks.getTree();
    const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[], path: string[]) => {
      for (const n of nodes) {
        if (n.url) {
          const meta = metaById.get(n.id);
          const save = saveByBookmark.get(n.id);
          const used = (n as chrome.bookmarks.BookmarkTreeNode & { dateLastUsed?: number }).dateLastUsed;
          items.push({
            key: 'b' + n.id,
            bookmarkId: n.id,
            saveId: save?.id,
            url: n.url,
            title: n.title || n.url,
            folder: path.filter(Boolean).slice(-2).join(' / ') || 'Bookmarks',
            addedAt: n.dateAdded,
            lastSeenAt: Math.max(used ?? 0, meta?.lastSeenAt ?? 0, save?.lastSeenAt ?? 0) || undefined,
            intent: save?.intent ?? meta?.intent,
            note: save?.note ?? meta?.note,
            remindAt: save?.remindAt,
            duplicate: false,
          });
        }
        if (n.children) walk(n.children, n.url ? path : [...path, n.title]);
      }
    };
    walk(tree, []);
  }
  for (const s of saves) {
    if (s.bookmarkId && items.some((i) => i.bookmarkId === s.bookmarkId)) continue;
    items.push({ key: 's' + s.id, saveId: s.id, url: s.url, title: s.title, folder: SAVES_FOLDER, addedAt: s.createdAt, lastSeenAt: s.lastSeenAt, intent: s.intent, note: s.note, remindAt: s.remindAt, duplicate: false });
  }
  const seen = new Map<string, number>();
  for (const i of items) seen.set(normalizeUrl(i.url), (seen.get(normalizeUrl(i.url)) ?? 0) + 1);
  for (const i of items) i.duplicate = (seen.get(normalizeUrl(i.url)) ?? 0) > 1;
  return items;
}

/** Topic shelves for the library: same TF-IDF engine as missions, tuned looser for short titles. */
export function topicShelves(items: LibraryItem[], threshold = 0.16): { name: string; items: LibraryItem[] }[] {
  if (!items.length) return [];
  // Titles are short, so the site counts twice and URL path words fill in context.
  const docs = items.map((i) => {
    const site = siteOf(i.url).split('.')[0]!;
    return [...tokenize(i.title), ...tokenize(i.title), ...pathWords(i.url).filter((w) => w.length > 2).map(stem), site, site];
  });
  const { vectors } = tfidf(docs);
  const clusters: { ids: number[]; c: ReturnType<typeof centroid> }[] = [];
  // Single pass leader clustering: fast enough for thousands of bookmarks.
  items.forEach((_, i) => {
    let best = -1;
    let bestSim = threshold;
    clusters.forEach((cl, k) => {
      const s = cosine(vectors[i]!, cl.c);
      if (s > bestSim) [best, bestSim] = [k, s];
    });
    if (best >= 0) {
      clusters[best]!.ids.push(i);
      clusters[best]!.c = centroid(clusters[best]!.ids.map((x) => vectors[x]!));
    } else clusters.push({ ids: [i], c: vectors[i]! });
  });
  const shelves = clusters
    .filter((c) => c.ids.length >= 2)
    .map((c) => ({ name: sentence(topTerms(c.c, 2).join(' & ')) || 'Misc', items: c.ids.map((i) => items[i]!) }))
    .sort((a, b) => b.items.length - a.items.length);
  const loose = clusters.filter((c) => c.ids.length < 2).flatMap((c) => c.ids.map((i) => items[i]!));
  if (loose.length) shelves.push({ name: 'Everything else', items: loose });
  return shelves;
}

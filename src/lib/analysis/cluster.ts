import type { PageType, Reason, Rule, TabView } from '../types';
import { cosine, centroid, tfidf, tokenize, type Vector } from '../text';
import { hostMatches, hostnameOf, pathWords, siteOf } from '../url';
import { pageTypeFromUrl, repoOf, searchQuery, siteHint } from './pagetype';

export interface Descriptor {
  tabId: number;
  title: string;
  site: string;
  pageType: PageType;
  query?: string;
  repo?: string;
  tokens: string[];
  summary: string;
}

export interface Cluster {
  key: string;
  tabIds: number[];
  /** Forced name from a rule or an existing Chrome group. */
  fixedName?: string;
  source: 'rule' | 'user' | 'similarity';
  /** Chrome group the cluster came from, if any. */
  groupId?: number;
  confidence: number;
  centroid: Vector;
  evidence: Map<number, Reason[]>;
}

export function describe(t: TabView): Descriptor {
  const snap = t.snapshot;
  const pageType = snap?.pageType && snap.pageType !== 'other' ? snap.pageType : pageTypeFromUrl(t.url);
  const query = searchQuery(t.url);
  const repo = repoOf(t.url);
  const title = t.title || snap?.title || t.url;
  const site = siteOf(t.url);
  const siteToken = site.split('.')[0] ?? '';
  // Title words count double; path words help for SPA pages with generic titles.
  const parts: string[] = [title, title, query ?? '', query ?? '', snap?.description ?? '', ...(snap?.headings.slice(0, 8) ?? [])];
  const tokens = [
    ...tokenize(parts.join(' ')),
    ...(snap?.keywords ?? []),
    ...pathWords(t.url).filter((w) => w.length > 2),
    ...(repo ? [repo.split('/')[1]!, repo.split('/')[1]!] : []),
  ].filter((w) => w !== siteToken);
  const summary = (snap?.description || snap?.text.slice(0, 600) || '').trim();
  return { tabId: t.id, title, site, pageType, query, repo, tokens, summary };
}

export function ruleMatches(rule: Rule, url: string): boolean {
  switch (rule.kind) {
    case 'domain':
      return hostMatches(hostnameOf(url), rule.pattern);
    case 'url-prefix':
      return url.replace(/^https?:\/\/(www\.)?/, '').startsWith(rule.pattern.replace(/^https?:\/\/(www\.)?/, ''));
    case 'url':
      return url === rule.pattern;
  }
}

class UnionFind {
  parent = new Map<number, number>();
  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let p = this.parent.get(x)!;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface ClusterOptions {
  rules: Rule[];
  similarity: number;
  /** Existing Chrome groups: groupId → title. Titled groups are treated as user-made missions. */
  groups: Map<number, { title: string }>;
}

/**
 * Turns tabs into clusters. Order of evidence, strongest first:
 * user rules → titled Chrome groups the user made → same repository → opener chains →
 * TF-IDF similarity with a same-site bonus (average-linkage agglomerative merge).
 */
export function clusterTabs(tabs: TabView[], descs: Map<number, Descriptor>, opts: ClusterOptions): Cluster[] {
  const clusters: Cluster[] = [];
  const assigned = new Set<number>();
  const byId = new Map(tabs.map((t) => [t.id, t]));

  // TF-IDF over everything so rule/group clusters still get centroids for naming.
  const order = tabs.map((t) => t.id);
  const { vectors } = tfidf(order.map((id) => descs.get(id)!.tokens));
  const vec = new Map(order.map((id, i) => [id, vectors[i]!]));

  // 1. Rules (most recent rule wins).
  const rules = [...opts.rules].sort((a, b) => b.createdAt - a.createdAt);
  const ruleBuckets = new Map<string, { ids: number[]; ev: Map<number, Reason[]> }>();
  for (const t of tabs) {
    const rule = rules.find((r) => ruleMatches(r, t.url));
    if (!rule) continue;
    const b = ruleBuckets.get(rule.missionName) ?? { ids: [] as number[], ev: new Map<number, Reason[]>() };
    b.ids.push(t.id);
    b.ev.set(t.id, [{ code: 'rule', text: `Matches your rule: ${rule.pattern} → ${rule.missionName}` }]);
    ruleBuckets.set(rule.missionName, b);
    assigned.add(t.id);
  }
  for (const [name, b] of ruleBuckets) {
    clusters.push({
      key: 'rule:' + name,
      tabIds: b.ids,
      fixedName: name,
      source: 'rule',
      confidence: 1,
      centroid: centroid(b.ids.map((id) => vec.get(id)!)),
      evidence: b.ev,
    });
  }

  // 2. Titled Chrome groups the user created.
  const groupBuckets = new Map<number, number[]>();
  for (const t of tabs) {
    if (assigned.has(t.id) || t.groupId < 0) continue;
    const g = opts.groups.get(t.groupId);
    if (!g?.title) continue;
    groupBuckets.set(t.groupId, [...(groupBuckets.get(t.groupId) ?? []), t.id]);
  }
  for (const [groupId, ids] of groupBuckets) {
    const title = opts.groups.get(groupId)!.title;
    const ev = new Map<number, Reason[]>();
    for (const id of ids) {
      assigned.add(id);
      ev.set(id, [{ code: 'group', text: `You put it in the Chrome group “${title}”` }]);
    }
    clusters.push({
      key: 'group:' + groupId,
      tabIds: ids,
      fixedName: title,
      source: 'user',
      groupId,
      confidence: 0.95,
      centroid: centroid(ids.map((id) => vec.get(id)!)),
      evidence: ev,
    });
  }

  // 3. Free tabs: union by repository and opener chains.
  const free = tabs.filter((t) => !assigned.has(t.id));
  const uf = new UnionFind();
  const evidence = new Map<number, Reason[]>();
  const addEv = (id: number, r: Reason) => evidence.set(id, [...(evidence.get(id) ?? []), r]);

  const byRepo = new Map<string, number[]>();
  for (const t of free) {
    const repo = descs.get(t.id)!.repo;
    if (repo) byRepo.set(repo, [...(byRepo.get(repo) ?? []), t.id]);
  }
  for (const [repo, ids] of byRepo) {
    for (const id of ids.slice(1)) uf.union(ids[0]!, id);
    if (ids.length > 1) for (const id of ids) addEv(id, { code: 'repo', text: `Part of the ${repo} repository` });
  }

  const freeIds = new Set(free.map((t) => t.id));
  for (const t of free) {
    const openerId = t.record?.openerTabId;
    if (openerId === undefined || !freeIds.has(openerId)) continue;
    const opener = byId.get(openerId)!;
    const hint = siteHint(opener.url);
    const sim = cosine(vec.get(t.id)!, vec.get(openerId)!);
    // Mail, chat and feeds open links to anything; only trust the chain when content agrees.
    if (hint?.hub && sim < opts.similarity * 0.6) continue;
    uf.union(t.id, openerId);
    const q = searchQuery(opener.url);
    addEv(t.id, {
      code: 'opener',
      text: q ? `Opened from your search “${q}”` : `Opened from “${truncate(opener.title, 60)}”`,
    });
  }

  // Seed groups from union-find components.
  const comps = new Map<number, number[]>();
  for (const t of free) {
    const root = uf.find(t.id);
    comps.set(root, [...(comps.get(root) ?? []), t.id]);
  }
  let groups = [...comps.values()].map((ids) => ({ ids, c: centroid(ids.map((id) => vec.get(id)!)), sites: new Set(ids.map((id) => descs.get(id)!.site)) }));

  // 4. Agglomerative merge on centroid similarity with a same-site bonus.
  const simOf = (a: (typeof groups)[number], b: (typeof groups)[number]) => {
    let s = cosine(a.c, b.c);
    for (const site of a.sites) {
      if (b.sites.has(site)) {
        const hint = siteHint('https://' + site);
        // Hubs and huge general sites (google.com, youtube.com) don't imply a shared topic.
        if (!hint?.hub && !['google.com', 'youtube.com', 'amazon.com', 'amazon.in', 'wikipedia.org'].includes(site)) s += 0.12;
        break;
      }
    }
    return s;
  };

  const n = groups.length;
  if (n > 1) {
    const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) sim[i]![j] = sim[j]![i] = simOf(groups[i]!, groups[j]!);
    const alive = new Array<boolean>(n).fill(true);
    const sizes = groups.map((g) => g.ids.length);
    for (;;) {
      let best = -1;
      let bi = -1;
      let bj = -1;
      for (let i = 0; i < n; i++) {
        if (!alive[i]) continue;
        const row = sim[i]!;
        for (let j = i + 1; j < n; j++) if (alive[j] && row[j]! > best) [best, bi, bj] = [row[j]!, i, j];
      }
      if (bi < 0 || best < opts.similarity) break;
      // Merge j into i (average linkage via Lance–Williams).
      const gi = groups[bi]!;
      const gj = groups[bj]!;
      gi.ids.push(...gj.ids);
      for (const s of gj.sites) gi.sites.add(s);
      gi.c = centroid(gi.ids.map((id) => vec.get(id)!));
      alive[bj] = false;
      for (let k = 0; k < n; k++) {
        if (!alive[k] || k === bi) continue;
        const v = (sizes[bi]! * sim[bi]![k]! + sizes[bj]! * sim[bj]![k]!) / (sizes[bi]! + sizes[bj]!);
        sim[bi]![k] = sim[k]![bi] = v;
      }
      sizes[bi]! += sizes[bj]!;
    }
    groups = groups.filter((_, i) => alive[i]);
  }

  for (const g of groups) {
    const terms = new Map<number, string[]>();
    if (g.ids.length > 1) {
      for (const id of g.ids) {
        const v = vec.get(id)!;
        const shared = [...v.keys()]
          .filter((t) => (g.c.get(t) ?? 0) > 0.08 && g.ids.some((o) => o !== id && vec.get(o)!.has(t)))
          .sort((a, b) => (g.c.get(b) ?? 0) - (g.c.get(a) ?? 0))
          .slice(0, 3);
        terms.set(id, shared);
        if (shared.length) addEv(id, { code: 'terms', text: `Shares ${shared.join(', ')} with other tabs in this mission` });
        const site = descs.get(id)!.site;
        const sameSite = g.ids.filter((o) => o !== id && descs.get(o)!.site === site).length;
        if (sameSite > 0 && !evidence.get(id)?.some((r) => r.code === 'repo'))
          addEv(id, { code: 'site', text: `Same site as ${sameSite} other tab${sameSite === 1 ? '' : 's'} here` });
      }
    }
    const ev = new Map(g.ids.map((id) => [id, evidence.get(id) ?? []]));
    clusters.push({
      key: 'sim:' + g.ids.slice().sort((a, b) => a - b)[0],
      tabIds: g.ids,
      source: 'similarity',
      confidence: clusterConfidence(g.ids, vec, g.c, evidence),
      centroid: g.c,
      evidence: ev,
    });
  }
  return clusters;
}

function clusterConfidence(ids: number[], vec: Map<number, Vector>, c: Vector, ev: Map<number, Reason[]>): number {
  if (ids.length === 1) {
    // A lone tab is only confident if something structural (repo, opener) links it — which can't happen alone.
    return 0.2;
  }
  const avg = ids.reduce((s, id) => s + cosine(vec.get(id)!, c), 0) / ids.length;
  const structural = ids.filter((id) => ev.get(id)?.some((r) => r.code === 'opener' || r.code === 'repo')).length / ids.length;
  return Math.min(0.98, 0.25 + avg * 0.6 + structural * 0.3 + Math.min(ids.length, 8) * 0.015);
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export { hostnameOf };

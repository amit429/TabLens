import type { GroupColor } from '../types';
import type { MissionKind, PageType, TabView, TabVerdict } from '../types';
import { titleCase, topTerms, type Vector } from '../text';
import type { Descriptor } from './cluster';
import { siteHint } from './pagetype';

export const GROUP_COLORS: GroupColor[] = ['blue', 'green', 'purple', 'orange', 'cyan', 'pink', 'yellow', 'red', 'grey'];

export function colorFor(name: string): GroupColor {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return GROUP_COLORS[h % (GROUP_COLORS.length - 1)]!;
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'mission'
  );
}

function dominant<T>(items: T[]): [T | undefined, number] {
  const counts = new Map<T, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  let best: T | undefined;
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return [best, items.length ? n / items.length : 0];
}

export function inferKind(descs: Descriptor[]): MissionKind {
  let work = 0;
  let personal = 0;
  for (const d of descs) {
    const hint = siteHint('https://' + d.site);
    if (hint?.kind === 'work' || d.pageType === 'docs' || d.pageType === 'repo' || d.pageType === 'issue') work++;
    else if (hint?.kind === 'personal' || d.pageType === 'product' || d.pageType === 'video') personal++;
  }
  return work > personal ? 'work' : 'personal';
}

const SITE_LABEL: Record<string, string> = {
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'notion.so': 'Notion',
  'figma.com': 'Figma',
  'linear.app': 'Linear',
  'atlassian.net': 'Jira',
  'google.com': 'Google',
  'youtube.com': 'YouTube',
  'stackoverflow.com': 'Stack Overflow',
  'reddit.com': 'Reddit',
  'amazon.com': 'Amazon',
  'amazon.in': 'Amazon',
  'flipkart.com': 'Flipkart',
  'wikipedia.org': 'Wikipedia',
  'arxiv.org': 'arXiv',
  'medium.com': 'Medium',
};

export function siteLabel(site: string): string {
  return SITE_LABEL[site] ?? titleCase(site.split('.')[0] ?? site);
}

const sentence = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/**
 * Terms that describe the whole mission: words most of its tabs share come first ("laptop" over
 * "zenbook"), ties broken by TF-IDF weight. Falls back to the strongest terms for one-tab missions.
 */
function sharedTerms(descs: Descriptor[], c: Vector, exclude: Set<string>, k = 3): string[] {
  if (descs.length < 2) return topTerms(c, k, exclude);
  const docCount = new Map<string, number>();
  for (const d of descs) for (const t of new Set(d.tokens)) docCount.set(t, (docCount.get(t) ?? 0) + 1);
  // Shared by at least half the tabs, then ranked by TF-IDF weight — so boilerplate that every page
  // has (near-zero weight) never beats the real subject.
  const half = Math.max(2, Math.ceil(descs.length / 2));
  const shared = [...c.keys()]
    .filter((t) => !exclude.has(t) && (docCount.get(t) ?? 0) >= half && (c.get(t) ?? 0) > 0.02)
    .sort((a, b) => (c.get(b) ?? 0) - (c.get(a) ?? 0));
  const rest = topTerms(c, k, new Set([...exclude, ...shared]));
  return [...shared, ...rest].slice(0, k);
}

/** Heuristic mission name when no model is available. Sentence case, short, specific. */
export function heuristicName(descs: Descriptor[], c: Vector): string {
  const repos = descs.map((d) => d.repo).filter(Boolean) as string[];
  const [repo] = dominant(repos);
  if (repo && repos.length >= descs.length / 2) return `${repo.split('/')[1]} (${repo.split('/')[0]})`;

  const [type, typeShare] = dominant(descs.map((d) => d.pageType));
  const [site, siteShare] = dominant(descs.map((d) => d.site));
  const siteTokens = new Set(descs.map((d) => d.site.split('.')[0]!));
  // Ticket-key prefixes ("EXP" in EXP-88) make poor names.
  for (const d of descs) for (const m of d.title.matchAll(/\b([a-z]{2,8})-\d+\b/gi)) siteTokens.add(m[1]!.toLowerCase());
  const terms = sharedTerms(descs, c, siteTokens);
  const query = descs.find((d) => d.query)?.query;
  // A search that started the mission is the best name there is.
  if (query && query.length <= 40) return sentence(query.toLowerCase());

  const topic = terms.length ? sentence(terms.slice(0, 2).join(' & ')) : '';
  if (!topic) return descs.length === 1 ? shortTitle(descs[0]!.title) : siteLabel(site ?? '');
  if (siteShare === 1 && descs.length > 1 && siteHint('https://' + site)?.app) return `${siteLabel(site!)}: ${topic.toLowerCase()}`;
  const prefix: Partial<Record<PageType, string>> = {
    product: 'Shopping',
    article: 'Reading',
    video: 'Watching',
    docs: 'Docs',
    issue: 'Tickets',
    search: 'Researching',
  };
  if (type && typeShare >= 0.6 && prefix[type] && descs.length > 1) return `${prefix[type]}: ${topic.toLowerCase()}`;
  return topic;
}

function shortTitle(t: string): string {
  const cut = t.split(/\s[|–—-]\s/)[0] ?? t;
  return cut.length > 40 ? cut.slice(0, 39) + '…' : cut;
}

export function intentLine(tabs: TabView[], descs: Descriptor[], c: Vector): string {
  const sites = new Set(descs.map((d) => d.site));
  const siteTokens = new Set(descs.map((d) => d.site.split('.')[0]!));
  const terms = sharedTerms(descs, c, siteTokens);
  const opened = tabs.map((t) => t.record?.openedAt).filter(Boolean) as number[];
  const spanDays = opened.length > 1 ? Math.round((Math.max(...opened) - Math.min(...opened)) / 86_400_000) : 0;
  const parts = [`${tabs.length} tab${tabs.length === 1 ? '' : 's'}`];
  if (terms.length) parts.push(`about ${terms.join(', ')}`);
  if (sites.size > 1) parts.push(`across ${sites.size} sites`);
  if (spanDays >= 1) parts.push(`opened over ${spanDays} day${spanDays === 1 ? '' : 's'}`);
  return parts.join(' ') + '.';
}

/** A one-line, mission-specific insight: shortlist for shopping, read/unread for reading, PRs for dev. */
export function missionInsight(tabs: TabView[], descs: Descriptor[], verdicts: Record<number, TabVerdict>): string | undefined {
  const types = descs.map((d) => d.pageType);
  const products = tabs.filter((_, i) => types[i] === 'product');
  if (products.length >= 2) {
    const ranked = [...products].sort((a, b) => (verdicts[b.id]?.engagement ?? 0) - (verdicts[a.id]?.engagement ?? 0));
    const top = ranked.filter((t) => (verdicts[t.id]?.engagement ?? 0) > 0.15).slice(0, 2);
    const barely = products.length - ranked.filter((t) => (verdicts[t.id]?.engagement ?? 0) > 0.15).length;
    const shortlist = top.map((t) => shortTitle(t.title)).join(', ');
    return [shortlist && `Shortlist: ${shortlist}`, barely > 0 && `${barely} product page${barely === 1 ? '' : 's'} barely opened`]
      .filter(Boolean)
      .join(' · ');
  }
  const reads = tabs.filter((_, i) => types[i] === 'article' || types[i] === 'docs');
  if (reads.length >= 2) {
    const done = reads.filter((t) => (t.record?.maxScroll ?? 0) >= 80).length;
    const started = reads.filter((t) => {
      const s = t.record?.maxScroll ?? 0;
      return s >= 20 && s < 80;
    }).length;
    return `${done} of ${reads.length} read${started ? `, ${started} half-read` : ''}`;
  }
  const issues = descs.filter((d) => d.pageType === 'issue').length;
  if (issues >= 1) {
    const prs = tabs.filter((t) => /\/pull\/\d+|merge_requests\/\d+/.test(t.url)).length;
    return [prs && `${prs} pull request${prs === 1 ? '' : 's'}`, issues - prs > 0 && `${issues - prs} issue${issues - prs === 1 ? '' : 's'}`]
      .filter(Boolean)
      .join(' and ') + ' open';
  }
  return undefined;
}

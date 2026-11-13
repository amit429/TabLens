import type { MissionKind, PageType } from '../types';
import { hostMatches, hostnameOf } from '../url';

interface SiteHint {
  domains: string[];
  type?: PageType;
  kind?: MissionKind;
  /** App-like site: extracted text is poor, group by title and URL pattern instead. */
  app?: boolean;
  /** Hub pages (mail, chat, feeds) open links to unrelated things, so opener chains from them are weak evidence. */
  hub?: boolean;
  label?: string;
}

export const SITE_HINTS: SiteHint[] = [
  { domains: ['github.com', 'gitlab.com', 'bitbucket.org'], type: 'repo', kind: 'work', label: 'GitHub' },
  { domains: ['atlassian.net', 'linear.app', 'jira.com', 'asana.com', 'clickup.com', 'monday.com', 'trello.com', 'height.app', 'shortcut.com'], type: 'issue', kind: 'work', app: true },
  { domains: ['notion.so', 'notion.site', 'docs.google.com', 'sheets.google.com', 'slides.google.com', 'figma.com', 'miro.com', 'confluence.com', 'coda.io', 'airtable.com', 'canva.com', 'office.com', 'sharepoint.com', 'dropbox.com', 'drive.google.com'], type: 'app', kind: 'work', app: true },
  { domains: ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'proton.me', 'fastmail.com'], type: 'mail', app: true, hub: true },
  { domains: ['slack.com', 'teams.microsoft.com', 'discord.com', 'web.whatsapp.com', 'web.telegram.org'], type: 'app', app: true, hub: true },
  { domains: ['calendar.google.com', 'meet.google.com', 'zoom.us'], type: 'app', kind: 'work', app: true, hub: true },
  { domains: ['vercel.com', 'netlify.com', 'console.aws.amazon.com', 'console.cloud.google.com', 'portal.azure.com', 'cloudflare.com', 'supabase.com', 'render.com', 'sentry.io', 'datadoghq.com', 'grafana.net', 'localhost', '127.0.0.1'], type: 'app', kind: 'work', app: true },
  { domains: ['stackoverflow.com', 'stackexchange.com', 'developer.mozilla.org', 'readthedocs.io', 'npmjs.com', 'pypi.org', 'docs.rs', 'pkg.go.dev', 'devdocs.io', 'learn.microsoft.com', 'developer.chrome.com', 'react.dev', 'tailwindcss.com'], type: 'docs', kind: 'work' },
  { domains: ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'netflix.com', 'primevideo.com', 'hotstar.com', 'disneyplus.com'], type: 'video', kind: 'personal' },
  { domains: ['amazon.com', 'amazon.in', 'amazon.co.uk', 'flipkart.com', 'ebay.com', 'etsy.com', 'bestbuy.com', 'walmart.com', 'myntra.com', 'croma.com', 'aliexpress.com', 'ikea.com', 'target.com', 'apple.com/shop'], type: 'product', kind: 'personal' },
  { domains: ['booking.com', 'airbnb.com', 'expedia.com', 'skyscanner.net', 'makemytrip.com', 'kayak.com', 'tripadvisor.com', 'google.com/travel', 'agoda.com', 'goibibo.com'], type: 'product', kind: 'personal', label: 'Travel' },
  { domains: ['twitter.com', 'x.com', 'reddit.com', 'linkedin.com', 'facebook.com', 'instagram.com', 'threads.net', 'news.ycombinator.com', 'bsky.app', 'mastodon.social'], type: 'social', hub: true },
  { domains: ['medium.com', 'substack.com', 'dev.to', 'hashnode.dev', 'wikipedia.org', 'arxiv.org', 'nytimes.com', 'theverge.com', 'techcrunch.com', 'bbc.com', 'theguardian.com', 'wired.com', 'arstechnica.com'], type: 'article' },
  { domains: ['spotify.com', 'music.youtube.com', 'soundcloud.com'], type: 'app', kind: 'personal', app: true },
];

export function siteHint(url: string): SiteHint | undefined {
  const host = hostnameOf(url);
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    /* ignore */
  }
  return SITE_HINTS.find((h) =>
    h.domains.some((d) => {
      const [dHost, dPath] = d.split(/\/(.*)/s);
      return hostMatches(host, dHost!) && (!dPath || path.startsWith('/' + dPath));
    }),
  );
}

const SEARCH_ENGINES: { host: string; path: RegExp; param: string }[] = [
  { host: 'google.', path: /^\/search/, param: 'q' },
  { host: 'bing.com', path: /^\/search/, param: 'q' },
  { host: 'duckduckgo.com', path: /^\//, param: 'q' },
  { host: 'search.brave.com', path: /^\/search/, param: 'q' },
  { host: 'kagi.com', path: /^\/search/, param: 'q' },
  { host: 'perplexity.ai', path: /^\/search/, param: 'q' },
  { host: 'youtube.com', path: /^\/results/, param: 'search_query' },
  { host: 'amazon.', path: /^\/s$/, param: 'k' },
  { host: 'flipkart.com', path: /^\/search/, param: 'q' },
  { host: 'github.com', path: /^\/search/, param: 'q' },
  { host: 'reddit.com', path: /\/search/, param: 'q' },
];

/** If the URL is a search results page, the query text. */
export function searchQuery(url: string): string | undefined {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    for (const e of SEARCH_ENGINES) {
      if ((host.startsWith(e.host) || host === e.host || host.endsWith('.' + e.host)) && e.path.test(u.pathname)) {
        const q = u.searchParams.get(e.param);
        if (q) return q.trim();
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/** Page type from URL alone, used when there is no snapshot. */
export function pageTypeFromUrl(url: string): PageType {
  if (searchQuery(url)) return 'search';
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    return 'other';
  }
  const hint = siteHint(url);
  if (hint?.type === 'repo') {
    if (/\/(pull|issues|merge_requests)\/\d+/.test(path)) return 'issue';
    if (path.split('/').filter(Boolean).length >= 2) return 'repo';
    return 'app';
  }
  if (hint?.type) return hint.type;
  if (/\/(docs?|documentation|reference|api|guide|manual)(\/|$)/i.test(path)) return 'docs';
  if (/\/(dp|product|products|p|item|itm|listing)\/[\w-]+/i.test(path)) return 'product';
  if (/\/(blog|posts?|articles?|news|story|stories|\d{4}\/\d{2})\//i.test(path)) return 'article';
  if (/\/(apply|signup|register|checkout|application|form)s?(\/|$)/i.test(path)) return 'form';
  return 'other';
}

/** Owner/repo for code-hosting URLs, e.g. "acme/expense-app". */
export function repoOf(url: string): string | undefined {
  const hint = siteHint(url);
  if (hint?.type !== 'repo') return undefined;
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && !['search', 'settings', 'notifications', 'orgs', 'marketplace', 'explore'].includes(parts[0]!)) {
      return `${parts[0]}/${parts[1]}`;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export const PAGE_TYPE_LABEL: Record<PageType, string> = {
  article: 'Article',
  product: 'Product',
  docs: 'Docs',
  repo: 'Repository',
  issue: 'Issue or PR',
  video: 'Video',
  search: 'Search',
  form: 'Form',
  app: 'App',
  social: 'Social',
  mail: 'Mail',
  other: 'Page',
};

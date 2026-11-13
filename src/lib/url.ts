const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'yclid',
  'ref',
  'ref_src',
  'ref_url',
  'source',
  'si',
  '_hsenc',
  '_hsmi',
  'spm',
  'trk',
  'trkCampaign',
  'share',
  'feature',
]);

const TRACKING_PREFIXES = ['utm_', 'pk_', 'mtm_', 'hsa_', 'vero_', 'oly_'];

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p));
}

/**
 * Normalises a URL so that the same page opened from different links compares equal:
 * lowercases host, drops `www.`, tracking parameters, plain fragments and trailing slashes,
 * and sorts the remaining query parameters.
 */
export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw.trim();
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return u.href;

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !isTrackingParam(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length
    ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';
  let path = u.pathname.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  // Hash routes (#/inbox, #!/thread) identify app views; anchors (#section) don't.
  const hash = /^#!?\//.test(u.hash) ? u.hash : '';
  const port = u.port && !['80', '443'].includes(u.port) ? `:${u.port}` : '';
  return `${u.protocol}//${host}${port}${path === '/' ? '' : path}${query}${hash}`;
}

export function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

const TWO_PART_TLDS = new Set(['co.uk', 'co.in', 'com.au', 'co.jp', 'com.br', 'co.nz', 'org.uk', 'ac.uk', 'gov.uk', 'co.za', 'com.sg', 'net.in', 'org.in']);

/** Best-effort registrable domain ("docs.github.com" → "github.com"). */
export function siteOf(raw: string): string {
  const host = raw.includes('://') ? hostnameOf(raw) : raw;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  return TWO_PART_TLDS.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

export function isWebUrl(raw: string): boolean {
  return /^https?:\/\//i.test(raw);
}

/** Pages where content scripts can't or shouldn't run. */
export function isReadableUrl(raw: string): boolean {
  if (!isWebUrl(raw)) return false;
  const host = hostnameOf(raw);
  if (host === 'chromewebstore.google.com' || host === 'chrome.google.com') return false;
  if (/\.pdf($|\?)/i.test(raw)) return false;
  return true;
}

/** True if `host` is `domain` or a subdomain of it. */
export function hostMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
  return host === d || host.endsWith('.' + d);
}

export function isExcluded(raw: string, excluded: string[]): boolean {
  const host = hostnameOf(raw);
  if (!host) return false;
  return excluded.some((d) => hostMatches(host, d));
}

/** Words from the URL path that help describe the page ("/reviews/macbook-air-m4" → ["reviews","macbook","air","m4"]). */
export function pathWords(raw: string): string[] {
  try {
    const u = new URL(raw);
    return u.pathname
      .split(/[/\-_.+]+/)
      .map((w) => decodeURIComponent(w).toLowerCase())
      .filter((w) => w.length > 1 && w.length < 30 && !/^\d+$/.test(w) && !/^[0-9a-f]{12,}$/.test(w));
  } catch {
    return [];
  }
}

/** Chrome's favicon cache for extensions (needs the "favicon" permission). */
export function faviconFor(pageUrl: string, size = 32): string {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return '';
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}

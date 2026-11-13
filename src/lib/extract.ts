import type { PageType } from './types';

/**
 * Readability-style extraction, kept small so it's cheap on every page load:
 * pick the densest content container, collect paragraph and list text, cap at ~2,000 words.
 * Runs only in pages TabLens is allowed to read; never touches form values.
 */

const MAX_WORDS = 2000;
const SKIP = 'nav, header, footer, aside, form, script, style, noscript, svg, button, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"], .sidebar, .comments, #comments, .ad, .ads, .advert';

function meta(name: string): string {
  const el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"], meta[property="${name}"]`);
  return el?.content?.trim() ?? '';
}

function textOf(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function pickContainer(): Element {
  const direct = document.querySelector('article, main, [role="main"], #content, .post-content, .article-body, .entry-content');
  if (direct && textOf(direct).length > 400) return direct;
  // Score block containers by paragraph text length.
  let best: Element = document.body;
  let bestScore = 0;
  for (const p of Array.from(document.querySelectorAll('p')).slice(0, 400)) {
    const parent = p.parentElement;
    if (!parent || parent.closest(SKIP)) continue;
    const score = Array.from(parent.children)
      .filter((c) => c.tagName === 'P')
      .reduce((s, c) => s + textOf(c).length, 0);
    if (score > bestScore) [best, bestScore] = [parent, score];
  }
  return best;
}

export function extractText(): string {
  const root = pickContainer();
  const parts: string[] = [];
  let words = 0;
  for (const el of Array.from(root.querySelectorAll('h1, h2, h3, p, li, blockquote, td, pre'))) {
    if (el.closest(SKIP)) continue;
    const t = textOf(el);
    if (t.length < 25 && !/^H/.test(el.tagName)) continue;
    parts.push(t);
    words += t.split(' ').length;
    if (words >= MAX_WORDS) break;
  }
  return parts.join('\n').split(/\s+/).slice(0, MAX_WORDS).join(' ');
}

export function extractHeadings(): string[] {
  return Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter((h) => !h.closest('nav, footer, aside'))
    .map(textOf)
    .filter((t) => t.length > 1 && t.length < 140)
    .slice(0, 24);
}

function jsonLdTypes(): string[] {
  const out: string[] = [];
  for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 10)) {
    try {
      const walk = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>;
          if (o['@type']) out.push(...([] as string[]).concat(o['@type'] as string));
          if (o['@graph']) walk(o['@graph']);
        }
      };
      walk(JSON.parse(s.textContent ?? ''));
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  }
  return out.map((t) => t.toLowerCase());
}

/** Page type from cheap signals; null means "let the URL decide". */
export function detectPageType(): PageType | null {
  const types = jsonLdTypes();
  const og = meta('og:type').toLowerCase();
  if (types.some((t) => t === 'product' || t === 'offer') || og === 'product' || meta('product:price:amount')) return 'product';
  if (types.some((t) => t.includes('video')) || og.startsWith('video')) return 'video';
  if (types.some((t) => /article|posting|report|scholarly/.test(t)) || og === 'article') return 'article';
  if (types.some((t) => t === 'softwaresourcecode' || t === 'techarticle')) return 'docs';
  const fields = document.querySelectorAll('form input:not([type=hidden]):not([type=search]):not([type=submit]), form textarea, form select').length;
  if (fields >= 4) return 'form';
  const paragraphs = document.querySelectorAll('article p, main p').length;
  if (paragraphs > 6) return 'article';
  return null;
}

export function capture() {
  return {
    url: location.href,
    title: document.title,
    description: meta('description') || meta('og:description'),
    siteName: meta('og:site_name') || undefined,
    headings: extractHeadings(),
    text: extractText(),
    pageType: detectPageType(),
  };
}

/** Inputs that count as "starting a form". Search boxes and chat composers don't. */
export function isFormField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement) {
    if (['search', 'hidden', 'submit', 'button', 'checkbox', 'radio', 'range', 'color'].includes(el.type)) return false;
    if (/^(q|query|search|s)$/i.test(el.name) || el.closest('[role="search"], form[action*="search"]')) return false;
    return !!el.closest('form') || el.type === 'email' || el.type === 'tel';
  }
  if (el instanceof HTMLTextAreaElement) return !!el.closest('form') || el.rows > 3;
  if (el instanceof HTMLSelectElement) return !!el.closest('form');
  return false;
}

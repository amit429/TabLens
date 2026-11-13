import { describe, expect, it } from 'vitest';
import { isExcluded, normalizeUrl, pathWords, siteOf } from './url';

describe('normalizeUrl', () => {
  it('strips tracking params, www, trailing slash and anchors', () => {
    expect(normalizeUrl('https://www.Example.com/a/b/?utm_source=x&b=2&a=1&fbclid=9#intro')).toBe('https://example.com/a/b?a=1&b=2');
  });
  it('keeps hash routes', () => {
    expect(normalizeUrl('https://mail.google.com/mail/u/0/#inbox')).toBe('https://mail.google.com/mail/u/0');
    expect(normalizeUrl('https://app.example.com/#/projects/1')).toBe('https://app.example.com#/projects/1');
  });
  it('treats the same page from different links as equal', () => {
    expect(normalizeUrl('https://theverge.com/review?utm_campaign=a')).toBe(normalizeUrl('https://www.theverge.com/review/'));
  });
  it('leaves non-web URLs alone', () => {
    expect(normalizeUrl('chrome://extensions/')).toBe('chrome://extensions/');
  });
});

describe('siteOf', () => {
  it('returns the registrable domain', () => {
    expect(siteOf('https://docs.github.com/en')).toBe('github.com');
    expect(siteOf('https://www.bbc.co.uk/news')).toBe('bbc.co.uk');
  });
});

describe('isExcluded', () => {
  it('matches subdomains', () => {
    expect(isExcluded('https://netbanking.hdfcbank.com/login', ['hdfcbank.com'])).toBe(true);
    expect(isExcluded('https://nothdfcbank.com', ['hdfcbank.com'])).toBe(false);
  });
});

describe('pathWords', () => {
  it('splits slugs and drops ids', () => {
    expect(pathWords('https://x.com/reviews/macbook-air-m4/1234567')).toEqual(['reviews', 'macbook', 'air', 'm4']);
  });
});

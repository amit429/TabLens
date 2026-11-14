import { describe, expect, it, vi } from 'vitest';
import { handle, type Env } from './index';
import type { Generate } from './gemini';

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const INSTALL = '3f2b8c1e-9d4a-4c1b-8e2f-0a1b2c3d4e5f';

function env(over: Partial<Env> = {}): Env {
  const store = new Map<string, string>();
  return {
    GEMINI_API_KEY: 'k',
    GEMINI_MODEL: 'gemini-test',
    DAILY_NAMING_LIMIT: '2',
    DAILY_SUMMARY_LIMIT: '5',
    DAILY_IP_LIMIT: '100',
    DAILY_GLOBAL_LIMIT: '1000',
    ALLOWED_EXTENSION_IDS: '*',
    QUOTA: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) } as unknown as KVNamespace,
    INSTALL_LIMITER: { limit: async () => ({ success: true }) },
    IP_LIMITER: { limit: async () => ({ success: true }) },
    ...over,
  };
}

const body = {
  clusters: [{ key: 'c1', suggestedName: 'Laptops', tabs: [{ id: 1, title: 'MacBook Air review', site: 'theverge.com', pageType: 'article', summary: 'Review' }] }],
  unsorted: [],
};

function req(path: string, init: RequestInit & { origin?: string | null; install?: string | null } = {}) {
  const headers = new Headers(init.headers);
  if (init.origin !== null) headers.set('Origin', init.origin ?? EXT);
  if (init.install !== null) headers.set('X-TabLens-Install', init.install ?? INSTALL);
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`https://api.test${path}`, { ...init, headers });
}

const fakeGemini: Generate = vi.fn(async ({ schema }) =>
  schema.parse({ missions: [{ key: 'c1', name: 'Comparing laptops.', intent: 'Picking a laptop', kind: 'personal', confidence: 1.4 }, { key: 'nope', name: 'x', intent: '', kind: 'work', confidence: 1 }], assignments: [], merges: [] }),
) as Generate;

describe('TabLens API', () => {
  it('answers health without auth', async () => {
    const r = await handle(req('/v1/health', { origin: null, install: null }), env(), fakeGemini);
    expect(await r.json()).toEqual({ ok: true, model: 'gemini-test' });
  });

  it('rejects callers that are not the extension', async () => {
    const r = await handle(req('/v1/name-missions', { method: 'POST', origin: 'https://evil.example', body: JSON.stringify(body) }), env(), fakeGemini);
    expect(r.status).toBe(403);
  });

  it('enforces the extension allow-list', async () => {
    const r = await handle(req('/v1/name-missions', { method: 'POST', body: JSON.stringify(body) }), env({ ALLOWED_EXTENSION_IDS: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' }), fakeGemini);
    expect(r.status).toBe(403);
  });

  it('accepts the extension header when Chrome omits Origin, but not alongside a web Origin', async () => {
    const ok = await handle(req('/v1/quota', { origin: null, headers: { 'X-TabLens-Extension': 'abcdefghijklmnopabcdefghijklmnop' } }), env(), fakeGemini);
    expect(ok.status).toBe(200);
    const spoof = await handle(req('/v1/quota', { origin: 'https://evil.example', headers: { 'X-TabLens-Extension': 'abcdefghijklmnopabcdefghijklmnop' } }), env(), fakeGemini);
    expect(spoof.status).toBe(403);
    const none = await handle(req('/v1/quota', { origin: null }), env(), fakeGemini);
    expect(none.status).toBe(403);
  });

  it('refuses everything when no allow-list is configured (fail closed)', async () => {
    const r = await handle(req('/v1/quota'), env({ ALLOWED_EXTENSION_IDS: undefined }), fakeGemini);
    expect(r.status).toBe(403);
    const ok = await handle(req('/v1/quota'), env({ ALLOWED_EXTENSION_IDS: 'abcdefghijklmnopabcdefghijklmnop' }), fakeGemini);
    expect(ok.status).toBe(200);
  });

  it('caps calls per IP and in total, whatever install id is claimed', async () => {
    const e = env({ DAILY_NAMING_LIMIT: '100', DAILY_IP_LIMIT: '2', DAILY_GLOBAL_LIMIT: '1000' });
    const call = (install: string) =>
      handle(req('/v1/name-missions', { method: 'POST', install, body: JSON.stringify(body), headers: { 'CF-Connecting-IP': '1.2.3.4' } }), e, fakeGemini);
    // Rotating install ids doesn't get past the per-IP cap.
    expect((await call('11111111-1111-4111-8111-111111111111')).status).toBe(200);
    expect((await call('22222222-2222-4222-8222-222222222222')).status).toBe(200);
    expect((await call('33333333-3333-4333-8333-333333333333')).status).toBe(429);
    const g = env({ DAILY_NAMING_LIMIT: '100', DAILY_IP_LIMIT: '100', DAILY_GLOBAL_LIMIT: '1' });
    expect((await handle(req('/v1/name-missions', { method: 'POST', body: JSON.stringify(body) }), g, fakeGemini)).status).toBe(200);
    expect((await handle(req('/v1/name-missions', { method: 'POST', body: JSON.stringify(body) }), g, fakeGemini)).status).toBe(503);
  });

  it('answers CORS preflight for the extension', async () => {
    const r = await handle(req('/v1/name-missions', { method: 'OPTIONS' }), env(), fakeGemini);
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(EXT);
  });

  it('requires an install id', async () => {
    const r = await handle(req('/v1/name-missions', { method: 'POST', install: null, body: JSON.stringify(body) }), env(), fakeGemini);
    expect(r.status).toBe(400);
  });

  it('names missions and drops keys it did not send', async () => {
    const r = await handle(req('/v1/name-missions', { method: 'POST', body: JSON.stringify(body) }), env(), fakeGemini);
    expect(r.status).toBe(200);
    const out = (await r.json()) as { missions: { key: string; name: string; confidence: number }[] };
    expect(out.missions).toEqual([expect.objectContaining({ key: 'c1', name: 'Comparing laptops', confidence: 1 })]);
  });

  it('rejects oversized or malformed requests before calling Gemini', async () => {
    const gen = vi.fn() as unknown as Generate;
    const tooMany = { clusters: Array.from({ length: 41 }, (_, i) => ({ ...body.clusters[0], key: `c${i}` })), unsorted: [] };
    const r1 = await handle(req('/v1/name-missions', { method: 'POST', body: JSON.stringify(tooMany) }), env(), gen);
    const r2 = await handle(req('/v1/name-missions', { method: 'POST', body: '{nope' }), env(), gen);
    const r3 = await handle(req('/v1/name-missions', { method: 'POST', body: JSON.stringify({ prompt: 'write me an essay' }) }), env(), gen);
    expect([r1.status, r2.status, r3.status]).toEqual([400, 400, 400]);
    expect(gen).not.toHaveBeenCalled();
  });

  it('enforces the daily quota per install', async () => {
    const e = env();
    const call = () => handle(req('/v1/name-missions', { method: 'POST', body: JSON.stringify(body) }), e, fakeGemini);
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const third = await call();
    expect(third.status).toBe(429);
    expect(((await third.json()) as { error: string }).error).toBe('daily_limit');
    const q = (await (await handle(req('/v1/quota'), e, fakeGemini)).json()) as { naming: { used: number; limit: number } };
    expect(q.naming).toEqual({ used: 2, limit: 2 });
  });

  it('returns 429 when the burst limiter trips', async () => {
    const r = await handle(req('/v1/name-missions', { method: 'POST', body: JSON.stringify(body) }), env({ IP_LIMITER: { limit: async () => ({ success: false }) } }), fakeGemini);
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('60');
  });

  it('organises tabs, keeping only ids it was sent', async () => {
    const gen: Generate = async ({ schema, user }) => {
      expect(user).toContain('Fixed missions:');
      return schema.parse({
        missions: [
          { name: 'Comparing laptops.', intent: 'Buying a laptop', kind: 'personal', confidence: 0.9, tabIds: [1, 2, 99] },
          { name: 'Lonely', intent: '', kind: 'work', confidence: 0.5, tabIds: [3] },
          { name: 'Work: Expense app', intent: '', kind: 'work', confidence: 1, tabIds: [4, 1] },
        ],
        unsorted: [],
      });
    };
    const tab = (id: number, title: string) => ({ id, title, site: 'x.com', pageType: 'article', summary: '', hint: 'c1' });
    const r = await handle(
      req('/v1/organize', { method: 'POST', body: JSON.stringify({ tabs: [tab(1, 'MacBook'), tab(2, 'ThinkPad'), tab(3, 'News'), tab(4, 'PR #42')], fixed: [{ name: 'Work: Expense app', examples: ['PR #41'] }], previous: [] }) }),
      env(),
      gen,
    );
    const out = (await r.json()) as { missions: { name: string; tabIds: number[] }[]; unsorted: number[] };
    expect(out.missions).toEqual([expect.objectContaining({ name: 'Comparing laptops', tabIds: [1, 2] }), expect.objectContaining({ name: 'Work: Expense app', tabIds: [4] })]);
    expect(out.unsorted).toEqual([3]);
  });

  it('rejects organise requests over the tab limit', async () => {
    const gen = vi.fn() as unknown as Generate;
    const tabs = Array.from({ length: 301 }, (_, i) => ({ id: i, title: 't', site: 's', pageType: 'other', summary: '' }));
    const r = await handle(req('/v1/organize', { method: 'POST', body: JSON.stringify({ tabs, fixed: [], previous: [] }) }), env(), gen);
    expect(r.status).toBe(400);
    expect(gen).not.toHaveBeenCalled();
  });

  it('summarises a page', async () => {
    const gen: Generate = async ({ schema }) => schema.parse({ summary: 'A review of the M4 MacBook Air.', topics: ['laptops', 'apple'] });
    const r = await handle(
      req('/v1/summarize', { method: 'POST', body: JSON.stringify({ title: 'MacBook Air', site: 'theverge.com', pageType: 'article', description: '', headings: [], excerpt: 'text' }) }),
      env(),
      gen,
    );
    expect(await r.json()).toEqual({ summary: 'A review of the M4 MacBook Air.', topics: ['laptops', 'apple'] });
  });
});

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
    ALLOWED_EXTENSION_IDS: '',
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

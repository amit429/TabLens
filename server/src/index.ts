import { ApiError } from '@google/genai';
import { z } from 'zod';
import {
  API_PATHS,
  EXTENSION_HEADER,
  INSTALL_HEADER,
  NameMissionsRequestSchema,
  NamerSchema,
  ORGANIZE_PROMPT,
  OrganizeRequestSchema,
  OrganizeSchema,
  buildOrganizePrompt,
  sanitizeOrganize,
  SUMMARY_PROMPT,
  SYSTEM_PROMPT,
  SummarizeRequestSchema,
  SummarySchema,
  buildSummaryInput,
  buildUserPrompt,
  sanitize,
  type HealthInfo,
  type QuotaInfo,
} from '../../src/lib/ai/contract';
import { geminiGenerator, mockGenerator, UpstreamError, type Generate } from './gemini';

/**
 * TabLens API. A deliberately narrow proxy in front of Gemini:
 * - holds the Gemini key so the extension never ships one,
 * - only runs two fixed prompts (name missions, summarise a page) on size-capped input,
 * - only answers extensions on the allow-list (a secret; with none set it refuses everything),
 * - rate-limits per install and per IP, with daily quotas per install, per IP and in total,
 * - never logs or stores request content.
 */

export interface Env {
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  DAILY_NAMING_LIMIT: string;
  DAILY_SUMMARY_LIMIT: string;
  /** Per IP per day, across installs — install ids are self-asserted, IPs aren't. */
  DAILY_IP_LIMIT: string;
  /** All callers together per day: the hard ceiling on Gemini spend. */
  DAILY_GLOBAL_LIMIT: string;
  /**
   * Secret. Comma-separated extension ids allowed to call the API, or "*" for any extension
   * (local development only). Unset means the API refuses every request (fail closed).
   */
  ALLOWED_EXTENSION_IDS?: string;
  QUOTA: KVNamespace;
  INSTALL_LIMITER: RateLimit;
  IP_LIMITER: RateLimit;
}

const MAX_BODY = 200_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Kind = 'naming' | 'summaries';

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    // GEMINI_API_KEY=mock gives deterministic fake answers for local development and e2e tests.
    const generate = env.GEMINI_API_KEY === 'mock' ? mockGenerator() : geminiGenerator(env.GEMINI_API_KEY, env.GEMINI_MODEL);
    return handle(request, env, generate);
  },
} satisfies ExportedHandler<Env>;

export async function handle(request: Request, env: Env, generate: Generate): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') ?? '';

  if (url.pathname === API_PATHS.health && request.method === 'GET') {
    return json<HealthInfo>({ ok: !!env.GEMINI_API_KEY, model: env.GEMINI_API_KEY === 'mock' ? 'mock' : env.GEMINI_MODEL }, 200, corsFor(origin, request.headers.get(EXTENSION_HEADER), env));
  }

  const cors = corsFor(origin, request.headers.get(EXTENSION_HEADER), env);
  if (!cors) return json({ error: 'forbidden', message: 'Only the TabLens extension can call this API.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const install = request.headers.get(INSTALL_HEADER) ?? '';
  if (!UUID.test(install)) return json({ error: 'missing_install_id' }, 400, cors);

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const [byInstall, byIp] = await Promise.all([env.INSTALL_LIMITER.limit({ key: install }), env.IP_LIMITER.limit({ key: ip })]);
  if (!byInstall.success || !byIp.success) return json({ error: 'rate_limited', message: 'Too many requests. Try again in a minute.' }, 429, { ...cors, 'Retry-After': '60' });

  try {
    if (url.pathname === API_PATHS.quota && request.method === 'GET') {
      return json<QuotaInfo>(await quota(env, install), 200, cors);
    }

    if (url.pathname === API_PATHS.organize && request.method === 'POST') {
      const body = OrganizeRequestSchema.parse(await readJson(request));
      if (!body.tabs.length) return json({ missions: [], unsorted: [] }, 200, cors);
      const limited = await overQuota(env, install, 'naming', ip);
      if (limited) return limited(cors);
      const out = await generate({ system: ORGANIZE_PROMPT, user: buildOrganizePrompt(body), schema: OrganizeSchema, maxOutputTokens: 16384 });
      await bump(env, install, 'naming', ip);
      return json(sanitizeOrganize(out, body), 200, cors);
    }

    if (url.pathname === API_PATHS.nameMissions && request.method === 'POST') {
      const body = NameMissionsRequestSchema.parse(await readJson(request));
      if (!body.clusters.length) return json({ missions: [], assignments: [], merges: [] }, 200, cors);
      const limited = await overQuota(env, install, 'naming', ip);
      if (limited) return limited(cors);
      const out = await generate({ system: SYSTEM_PROMPT, user: buildUserPrompt(body.clusters, body.unsorted), schema: NamerSchema });
      await bump(env, install, 'naming', ip);
      return json(sanitize(out, body.clusters), 200, cors);
    }

    if (url.pathname === API_PATHS.summarize && request.method === 'POST') {
      const body = SummarizeRequestSchema.parse(await readJson(request));
      const limited = await overQuota(env, install, 'summaries', ip);
      if (limited) return limited(cors);
      const out = await generate({ system: SUMMARY_PROMPT, user: buildSummaryInput(body), schema: SummarySchema });
      await bump(env, install, 'summaries', ip);
      return json({ summary: out.summary.slice(0, 400), topics: out.topics.slice(0, 5).map((t) => t.slice(0, 30)) }, 200, cors);
    }

    return json({ error: 'not_found' }, 404, cors);
  } catch (err) {
    if (err instanceof z.ZodError) return json({ error: 'invalid_request', issues: err.issues.slice(0, 5).map((i) => i.path.join('.')) }, 400, cors);
    if (err instanceof BodyError) return json({ error: 'invalid_request', message: err.message }, 400, cors);
    // Log the failure class only — never request content.
    if (err instanceof ApiError) {
      console.error('gemini_error', err.status);
      return json({ error: 'upstream', message: err.status === 429 ? 'AI is busy right now. Try again shortly.' : 'The AI service failed.' }, err.status === 429 ? 503 : 502, cors);
    }
    if (err instanceof UpstreamError || err instanceof SyntaxError) {
      console.error('gemini_bad_output');
      return json({ error: 'upstream', message: 'The AI returned an unusable answer.' }, 502, cors);
    }
    console.error('internal_error', err instanceof Error ? err.name : typeof err);
    return json({ error: 'internal' }, 500, cors);
  }
}

/**
 * CORS headers when the caller is an allowed extension; null otherwise.
 * The id comes from the Origin header, or — only when there is no Origin at all — from the
 * extension header. Browsers always attach Origin to cross-site requests from web pages, so a
 * website can't pass itself off as the extension.
 */
function corsFor(origin: string, extensionHeader: string | null, env: Env): Record<string, string> | null {
  const fromOrigin = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin)?.[1];
  const id = origin ? fromOrigin : extensionHeader && /^[a-p]{32}$/.test(extensionHeader) ? extensionHeader : undefined;
  if (!id) return null;
  // Fail closed: no allow-list configured means nobody gets in. "*" opens it up for local dev.
  const allowed = (env.ALLOWED_EXTENSION_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes('*') && !allowed.includes(id)) return null;
  return {
    'Access-Control-Allow-Origin': origin || `chrome-extension://${id}`,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, ${INSTALL_HEADER}, ${EXTENSION_HEADER}`,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

class BodyError extends Error {}

async function readJson(request: Request): Promise<unknown> {
  const len = Number(request.headers.get('Content-Length') ?? 0);
  if (len > MAX_BODY) throw new BodyError('Request too large');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new BodyError('Request too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new BodyError('Body is not valid JSON');
  }
}

function day() {
  return new Date().toISOString().slice(0, 10);
}

function limitFor(env: Env, kind: Kind) {
  return Number(kind === 'naming' ? env.DAILY_NAMING_LIMIT : env.DAILY_SUMMARY_LIMIT) || 0;
}

async function used(env: Env, install: string, kind: Kind) {
  return Number((await env.QUOTA.get(`${kind}:${install}:${day()}`)) ?? 0);
}

async function overQuota(env: Env, install: string, kind: Kind, ip = 'unknown') {
  const [byIp, total] = await Promise.all([counter(env, `ip:${ip}:${day()}`), counter(env, `global:${day()}`)]);
  if (total >= (Number(env.DAILY_GLOBAL_LIMIT) || 0))
    return (cors: Record<string, string>) => json({ error: 'busy', message: 'TabLens AI has reached its daily capacity. It resets at midnight UTC.' }, 503, cors);
  if (byIp >= (Number(env.DAILY_IP_LIMIT) || 0))
    return (cors: Record<string, string>) => json({ error: 'daily_limit', message: 'Daily AI limit reached for this network. It resets at midnight UTC.' }, 429, cors);
  const n = await used(env, install, kind);
  if (n < limitFor(env, kind)) return null;
  return (cors: Record<string, string>) =>
    json({ error: 'daily_limit', message: `Daily AI limit reached (${limitFor(env, kind)} ${kind === 'naming' ? 'analyses' : 'summaries'}). It resets at midnight UTC.` }, 429, cors);
}

async function counter(env: Env, key: string) {
  return Number((await env.QUOTA.get(key)) ?? 0);
}

/** KV counters are approximate under concurrency, which is fine for fair-use caps. */
async function bump(env: Env, install: string, kind: Kind, ip = 'unknown') {
  await Promise.all(
    [`${kind}:${install}:${day()}`, `ip:${ip}:${day()}`, `global:${day()}`].map(async (key) => {
      const n = await counter(env, key);
      await env.QUOTA.put(key, String(n + 1), { expirationTtl: 2 * 86_400 });
    }),
  );
}

async function quota(env: Env, install: string): Promise<QuotaInfo> {
  const [naming, summaries] = await Promise.all([used(env, install, 'naming'), used(env, install, 'summaries')]);
  const reset = new Date();
  reset.setUTCHours(24, 0, 0, 0);
  return {
    naming: { used: naming, limit: limitFor(env, 'naming') },
    summaries: { used: summaries, limit: limitFor(env, 'summaries') },
    resetsAt: reset.toISOString(),
  };
}

function json<T>(data: T, status = 200, headers: Record<string, string> | null = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(headers ?? {}) } });
}

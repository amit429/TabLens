import { z } from 'zod';
import type { Namer } from '../analysis/analyze';
import { updateSettings, type Settings } from '../settings';
import type { Snapshot } from '../types';
import {
  API_PATHS,
  EXTENSION_HEADER,
  INSTALL_HEADER,
  LIMITS,
  NamerSchema,
  SUMMARY_PROMPT,
  SYSTEM_PROMPT,
  SummarySchema,
  buildSummaryInput,
  buildUserPrompt,
  clampRequest,
  sanitize,
  type HealthInfo,
  type QuotaInfo,
  type SummarizeRequest,
} from './contract';

/**
 * AI routing. Everything is Gemini, and users never need a key:
 *  1. Gemini Nano on device through Chrome's Prompt API — private and free, used first when available.
 *  2. TabLens AI — our API (server/) holds the Gemini key; the extension sends short descriptors only.
 *  3. No model — heuristic names from the clustering engine.
 */

/** Where the TabLens API lives. Set at build time with TABLENS_API (see wxt.config.ts). */
export const API_BASE: string = import.meta.env.WXT_TABLENS_API || 'http://localhost:8787';

interface LanguageModelSession {
  prompt(input: string, opts?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
interface LanguageModelStatic {
  availability(opts?: object): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(opts?: object): Promise<LanguageModelSession>;
}
declare const LanguageModel: LanguageModelStatic | undefined;

export type NanoStatus = 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

const LANG = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

export async function nanoStatus(): Promise<NanoStatus> {
  if (typeof LanguageModel === 'undefined') return 'unsupported';
  try {
    return await LanguageModel.availability(LANG);
  } catch {
    return 'unavailable';
  }
}

/** Starts the on-device model download; Chrome requires a user gesture, so call it from a page. */
export async function downloadNano(onProgress?: (fraction: number) => void): Promise<boolean> {
  if (typeof LanguageModel === 'undefined') return false;
  const s = await LanguageModel.create({
    ...LANG,
    monitor(m: EventTarget) {
      m.addEventListener('downloadprogress', (e) => onProgress?.((e as ProgressEvent).loaded));
    },
  });
  s.destroy();
  return true;
}

const nanoNamer: Namer = async (clusters, unsorted) => {
  const session = await LanguageModel!.create({ ...LANG, initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }] });
  try {
    // Nano's context window is small, so clusters go in batches of six.
    const out: z.infer<typeof NamerSchema> = { missions: [], assignments: [], merges: [] };
    for (let i = 0; i < clusters.length; i += 6) {
      const batch = clusters.slice(i, i + 6);
      const raw = await session.prompt(buildUserPrompt(batch, i === 0 ? unsorted.slice(0, 15) : [], 20), { responseConstraint: z.toJSONSchema(NamerSchema) });
      const res = sanitize(NamerSchema.parse(JSON.parse(raw)), batch);
      out.missions.push(...res.missions);
      out.assignments.push(...res.assignments);
      out.merges.push(...res.merges);
    }
    return out;
  } finally {
    session.destroy();
  }
};

/** A failed call to the TabLens API, with a message fit to show the user. */
export class CloudError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(settings: Settings, path: string, init: { method: 'GET' | 'POST'; body?: unknown; timeoutMs?: number }): Promise<T> {
  if (!settings.installId) settings = await updateSettings({ installId: crypto.randomUUID() });
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', [INSTALL_HEADER]: settings.installId, [EXTENSION_HEADER]: chrome.runtime.id },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 45_000),
    });
  } catch (err) {
    throw new CloudError(err instanceof DOMException && err.name === 'TimeoutError' ? 'TabLens AI took too long to answer.' : 'Couldn’t reach TabLens AI. Check your connection.', 'network', 0);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new CloudError(data.message ?? `TabLens AI error ${res.status}`, data.error ?? 'http', res.status);
  }
  return (await res.json()) as T;
}

function cloudNamer(settings: Settings): Namer {
  return async (clusters, unsorted) => {
    const body = clampRequest(clusters, unsorted);
    const out = await call<z.infer<typeof NamerSchema>>(settings, API_PATHS.nameMissions, { method: 'POST', body });
    return sanitize(NamerSchema.parse(out), body.clusters);
  };
}

/** Health and today's quota for the Settings page. */
export async function cloudStatus(settings: Settings): Promise<{ ok: boolean; message: string; model?: string; quota?: QuotaInfo }> {
  try {
    const health = await call<HealthInfo>(settings, API_PATHS.health, { method: 'GET', timeoutMs: 10_000 });
    if (!health.ok) return { ok: false, message: 'TabLens AI is up but not configured yet.' };
    const quota = await call<QuotaInfo>(settings, API_PATHS.quota, { method: 'GET', timeoutMs: 10_000 });
    return { ok: true, message: 'Connected', model: health.model, quota };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** What the extension sends to summarise a page: never the full text. */
export function summaryRequest(snap: Snapshot): SummarizeRequest {
  return {
    title: snap.title.slice(0, LIMITS.title),
    site: (snap.siteName || new URL(snap.url).hostname).slice(0, LIMITS.site),
    pageType: snap.pageType,
    description: snap.description.slice(0, LIMITS.description),
    headings: snap.headings.slice(0, LIMITS.headings).map((h) => h.slice(0, LIMITS.heading)),
    excerpt: snap.text.split(/\s+/).slice(0, 100).join(' ').slice(0, LIMITS.excerpt),
  };
}

/** Two-sentence "what is this page" summary for the tab dossier. */
export async function summarize(settings: Settings, snap: Snapshot): Promise<{ summary: string; topics: string[]; engine: 'nano' | 'cloud' } | null> {
  const mode = settings.ai.mode;
  if (mode === 'off') return null;
  if ((mode === 'auto' || mode === 'nano') && (await nanoStatus()) === 'available') {
    const s = await LanguageModel!.create({ ...LANG, initialPrompts: [{ role: 'system', content: SUMMARY_PROMPT }] });
    try {
      // On device the whole (capped) snapshot can be used — it never leaves the computer.
      const input = buildSummaryInput({ ...summaryRequest(snap), excerpt: snap.text.split(/\s+/).slice(0, 600).join(' ') });
      const raw = await s.prompt(input, { responseConstraint: z.toJSONSchema(SummarySchema) });
      return { ...SummarySchema.parse(JSON.parse(raw)), engine: 'nano' };
    } finally {
      s.destroy();
    }
  }
  if ((mode === 'auto' || mode === 'cloud') && settings.ai.cloudConsent) {
    const out = await call<z.infer<typeof SummarySchema>>(settings, API_PATHS.summarize, { method: 'POST', body: summaryRequest(snap) });
    return { ...SummarySchema.parse(out), engine: 'cloud' };
  }
  return null;
}

export async function pickNamer(settings: Settings): Promise<{ namer?: Namer; engine: 'nano' | 'cloud' | 'heuristic' }> {
  const mode = settings.ai.mode;
  if (mode === 'off') return { engine: 'heuristic' };
  if ((mode === 'auto' || mode === 'nano') && (await nanoStatus()) === 'available') return { namer: nanoNamer, engine: 'nano' };
  if ((mode === 'auto' || mode === 'cloud') && settings.ai.cloudConsent) return { namer: cloudNamer(settings), engine: 'cloud' };
  return { engine: 'heuristic' };
}

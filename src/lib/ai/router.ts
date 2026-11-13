import { ApiError, GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';
import type { Namer, NamerCluster } from '../analysis/analyze';
import type { Settings } from '../settings';
import type { Snapshot } from '../types';
import { NamerSchema, SUMMARY_PROMPT, SYSTEM_PROMPT, buildUserPrompt, sanitize } from './prompt';

/**
 * AI routing. Everything is Gemini:
 *  1. Gemini Nano on-device through Chrome's Prompt API — private and free, used first when available.
 *  2. Gemini API with the user's own key — opt-in; only short tab descriptors are sent.
 *  3. No model — heuristic names from the clustering engine.
 */

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

export const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: 'Best names, still fast' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', note: 'Cheapest and fastest' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', note: 'Previous Flash generation' },
];

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

const namerJsonSchema = z.toJSONSchema(NamerSchema);

const nanoNamer: Namer = async (clusters, unsorted) => {
  const session = await LanguageModel!.create({ ...LANG, initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }] });
  try {
    // Nano's context window is small, so clusters go in batches of six.
    const out = {
      missions: [] as ReturnType<typeof sanitize>['missions'],
      assignments: [] as NonNullable<ReturnType<typeof sanitize>['assignments']>,
      merges: [] as NonNullable<ReturnType<typeof sanitize>['merges']>,
    };
    for (let i = 0; i < clusters.length; i += 6) {
      const batch = clusters.slice(i, i + 6);
      const raw = await session.prompt(buildUserPrompt(batch, i === 0 ? unsorted.slice(0, 15) : [], 20), { responseConstraint: namerJsonSchema });
      const res = sanitize(NamerSchema.parse(JSON.parse(raw)), batch);
      out.missions.push(...res.missions);
      out.assignments.push(...(res.assignments ?? []));
      out.merges.push(...(res.merges ?? []));
    }
    return out;
  } finally {
    session.destroy();
  }
};

function client(settings: Settings) {
  return new GoogleGenAI({ apiKey: settings.ai.apiKey });
}

async function geminiJson<T>(settings: Settings, system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  const res = await client(settings).models.generateContent({
    model: settings.ai.model,
    contents: user,
    config: {
      systemInstruction: system,
      responseMimeType: 'application/json',
      responseJsonSchema: z.toJSONSchema(schema),
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      temperature: 0.2,
    },
  });
  const text = res.text;
  if (!text) throw new Error(`Gemini returned no text (${res.candidates?.[0]?.finishReason ?? 'unknown reason'})`);
  return schema.parse(JSON.parse(text));
}

function geminiNamer(settings: Settings): Namer {
  return async (clusters: NamerCluster[], unsorted) =>
    sanitize(await geminiJson(settings, SYSTEM_PROMPT, buildUserPrompt(clusters, unsorted), NamerSchema), clusters);
}

export function describeError(err: unknown, model: string): string {
  if (err instanceof ApiError) {
    if (err.status === 400 && /API key/i.test(err.message)) return 'The Gemini API key was rejected. Check it in Google AI Studio.';
    if (err.status === 401 || err.status === 403) return 'The Gemini API key was rejected or lacks access. Check it in Google AI Studio.';
    if (err.status === 404) return `Model ${model} isn't available for this key. Pick another model.`;
    if (err.status === 429) return 'Gemini rate limit or quota reached. Try again in a minute.';
    return `Gemini API error ${err.status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function testGemini(settings: Settings): Promise<{ ok: boolean; message: string }> {
  if (!settings.ai.apiKey) return { ok: false, message: 'Add a Gemini API key first.' };
  try {
    const res = await client(settings).models.generateContent({
      model: settings.ai.model,
      contents: 'Reply with the single word OK.',
      config: { maxOutputTokens: 256, thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
    });
    return { ok: true, message: `Connected to ${settings.ai.model}${res.text ? '' : ' (empty reply)'}.` };
  } catch (err) {
    return { ok: false, message: describeError(err, settings.ai.model) };
  }
}

const SummarySchema = z.object({
  summary: z.string(),
  topics: z.array(z.string()),
});

/** Two-sentence "what is this page" summary for the tab dossier. */
export async function summarize(settings: Settings, snap: Snapshot): Promise<{ summary: string; topics: string[]; engine: 'nano' | 'cloud' } | null> {
  const input = `Title: ${snap.title}\nSite: ${snap.siteName ?? ''}\nType: ${snap.pageType}\nDescription: ${snap.description}\nHeadings: ${snap.headings.slice(0, 12).join(' | ')}\n\n${snap.text.split(/\s+/).slice(0, 900).join(' ')}`;
  const mode = settings.ai.mode;
  if (mode === 'off') return null;
  if ((mode === 'auto' || mode === 'nano') && (await nanoStatus()) === 'available') {
    const s = await LanguageModel!.create({ ...LANG, initialPrompts: [{ role: 'system', content: SUMMARY_PROMPT }] });
    try {
      const raw = await s.prompt(input.split(/\s+/).slice(0, 700).join(' '), { responseConstraint: z.toJSONSchema(SummarySchema) });
      return { ...SummarySchema.parse(JSON.parse(raw)), engine: 'nano' };
    } finally {
      s.destroy();
    }
  }
  if ((mode === 'auto' || mode === 'cloud') && settings.ai.cloudConsent && settings.ai.apiKey) {
    // Cloud path never sends full page text: cap at ~100 words of body plus title/description/headings.
    const descriptor = input.split('\n\n')[0] + '\n\n' + snap.text.split(/\s+/).slice(0, 100).join(' ');
    return { ...(await geminiJson(settings, SUMMARY_PROMPT, descriptor, SummarySchema)), engine: 'cloud' };
  }
  return null;
}

export async function pickNamer(settings: Settings): Promise<{ namer?: Namer; engine: 'nano' | 'cloud' | 'heuristic' }> {
  const mode = settings.ai.mode;
  if (mode === 'off') return { engine: 'heuristic' };
  if ((mode === 'auto' || mode === 'nano') && (await nanoStatus()) === 'available') return { namer: nanoNamer, engine: 'nano' };
  if ((mode === 'auto' || mode === 'cloud') && settings.ai.cloudConsent && settings.ai.apiKey) return { namer: geminiNamer(settings), engine: 'cloud' };
  return { engine: 'heuristic' };
}

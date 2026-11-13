import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';

export type Generate = <T>(opts: { system: string; user: string; schema: z.ZodType<T>; maxOutputTokens?: number }) => Promise<T>;

/** Structured JSON generation with Gemini, validated against the zod schema. */
export function geminiGenerator(apiKey: string, model: string): Generate {
  const ai = new GoogleGenAI({ apiKey });
  return async ({ system, user, schema, maxOutputTokens }) => {
    const res = await ai.models.generateContent({
      model,
      contents: user,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseJsonSchema: z.toJSONSchema(schema),
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        temperature: 0.2,
        maxOutputTokens: maxOutputTokens ?? 4096,
      },
    });
    const text = res.text;
    if (!text) throw new UpstreamError(`Gemini returned no text (${res.candidates?.[0]?.finishReason ?? 'unknown'})`);
    return schema.parse(JSON.parse(text));
  };
}

export class UpstreamError extends Error {}

/**
 * Deterministic stand-in for Gemini (GEMINI_API_KEY=mock): groups organise requests by their hint and
 * echoes plausible names, so the full AI-first flow can be tested without a key or cost.
 */
export function mockGenerator(): Generate {
  return async ({ user, schema }) => {
    const tabs = [...user.matchAll(/^\[(\d+)\] (.+?) \(([^,]+), (\w+)\)(?: — .*?)?(?: \{(.+?)\})?$/gm)].map((m) => ({ id: Number(m[1]), title: m[2]!, hint: m[5] }));
    if (tabs.length) {
      const byHint = new Map<string, typeof tabs>();
      for (const t of tabs) if (t.hint) byHint.set(t.hint, [...(byHint.get(t.hint) ?? []), t]);
      const missions = [...byHint.values()]
        .filter((g) => g.length >= 2)
        .map((g) => ({ name: `Mock: ${g[0]!.title.split(/\s+/).slice(0, 3).join(' ')}`, intent: 'Mock mission from hints', kind: 'personal', confidence: 0.9, tabIds: g.map((t) => t.id) }));
      const used = new Set(missions.flatMap((m) => m.tabIds));
      return schema.parse({ missions, unsorted: tabs.filter((t) => !used.has(t.id)).map((t) => t.id) });
    }
    const clusters = [...user.matchAll(/^Cluster (\S+) \(suggested: (.+)\)$/gm)];
    if (clusters.length)
      return schema.parse({ missions: clusters.map((c) => ({ key: c[1], name: `Mock: ${c[2]}`, intent: 'Mock', kind: 'personal', confidence: 0.9 })), assignments: [], merges: [] });
    return schema.parse({ summary: 'A mock summary of this page.', topics: ['mock'] });
  };
}

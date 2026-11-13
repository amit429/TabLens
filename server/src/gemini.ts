import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';

export type Generate = <T>(opts: { system: string; user: string; schema: z.ZodType<T> }) => Promise<T>;

/** Structured JSON generation with Gemini, validated against the zod schema. */
export function geminiGenerator(apiKey: string, model: string): Generate {
  const ai = new GoogleGenAI({ apiKey });
  return async ({ system, user, schema }) => {
    const res = await ai.models.generateContent({
      model,
      contents: user,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseJsonSchema: z.toJSONSchema(schema),
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        temperature: 0.2,
        maxOutputTokens: 4096,
      },
    });
    const text = res.text;
    if (!text) throw new UpstreamError(`Gemini returned no text (${res.candidates?.[0]?.finishReason ?? 'unknown'})`);
    return schema.parse(JSON.parse(text));
  };
}

export class UpstreamError extends Error {}

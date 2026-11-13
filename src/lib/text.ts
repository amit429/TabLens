const STOP = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves
  new get got one two use used using via vs best top new free online official home page site welcome login sign signin log account search results result www com org net html http https index view edit open click read more find see show watch video videos news blog post posts article articles guide guides review reviews how what why tips 2024 2025 2026 2027 latest today update updated
  untitled loading dashboard inbox`.split(/\s+/),
);

/** Light plural folding so "laptops" and "laptop" match. Deliberately conservative. */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && /(ches|shes|xes|sses|zes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is|os|as)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Lowercase word tokens without stop words; keeps short model numbers like "m4" or "rtx". */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#]*/gu) ?? [])
    .filter((w) => w.length > 1 && w.length < 28 && !STOP.has(w) && !/^\d{1,3}$/.test(w))
    .map(stem);
}

export type Vector = Map<string, number>;

export interface TfIdf {
  vectors: Vector[];
  idf: Map<string, number>;
}

/** TF-IDF vectors (L2-normalised) for a set of documents given as token lists. */
export function tfidf(docs: string[][]): TfIdf {
  const df = new Map<string, number>();
  for (const doc of docs) for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const idf = new Map<string, number>();
  // Terms on (nearly) every page — boilerplate, cookie banners, shared nav — carry no signal, so
  // they get ~0 weight instead of the usual smoothed +1. Small sets keep a floor so 2–3 tabs still compare.
  const floor = n < 6 ? 0.35 : 0.02;
  for (const [t, d] of df) idf.set(t, Math.max(floor, Math.log((1 + n) / (1 + d)) + (n < 6 ? 1 : 0.15 * (1 - d / n))));

  const vectors = docs.map((doc) => {
    const tf = new Map<string, number>();
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v: Vector = new Map();
    let norm = 0;
    for (const [t, c] of tf) {
      const w = (1 + Math.log(c)) * (idf.get(t) ?? 1);
      v.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
  return { vectors, idf };
}

export function cosine(a: Vector, b: Vector): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const o = large.get(t);
    if (o) dot += w * o;
  }
  return dot;
}

/** Sum of vectors, normalised; used as a cluster centroid. */
export function centroid(vs: Vector[]): Vector {
  const c: Vector = new Map();
  for (const v of vs) for (const [t, w] of v) c.set(t, (c.get(t) ?? 0) + w);
  let norm = 0;
  for (const w of c.values()) norm += w * w;
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of c) c.set(t, w / norm);
  return c;
}

export function topTerms(v: Vector, k: number, exclude: Set<string> = new Set()): string[] {
  return [...v.entries()]
    .filter(([t]) => !exclude.has(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([t]) => t);
}

/** Keywords for a single document: most frequent non-stop tokens. */
export function keywords(text: string, k = 8): string[] {
  const counts = new Map<string, number>();
  for (const t of tokenize(text)) if (t.length > 2) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([t]) => t);
}

export function titleCase(s: string): string {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function truncateWords(text: string, max: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= max ? words.join(' ') : words.slice(0, max).join(' ') + '…';
}

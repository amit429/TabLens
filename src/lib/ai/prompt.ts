import { z } from 'zod';
import type { NamerCluster, NamerResult } from '../analysis/analyze';

export const NamerSchema = z.object({
  missions: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      intent: z.string(),
      kind: z.enum(['work', 'personal']),
      confidence: z.number(),
    }),
  ),
  assignments: z.array(z.object({ tabId: z.number(), key: z.string() })),
  merges: z.array(z.object({ from: z.string(), into: z.string() })),
});

export const SYSTEM_PROMPT = `You name "missions" for a browser tab organiser.
A mission is the task a group of open tabs serves, written the way the user would say it:
"Comparing laptops under ₹80k", "Reviewing expense-app PR #42", "Planning Goa trip in December".

For each cluster you get its key, a suggested name and its tabs (title, site, page type, short summary).
Return for every cluster:
- name: at most 5 words, specific, sentence case, no emoji, no trailing punctuation
- intent: one short sentence saying what the user seems to be doing
- kind: "work" (job, code, docs, tickets, professional tools) or "personal"
- confidence: 0 to 1, how coherent the cluster is

If two clusters are clearly the same task (e.g. product pages and reviews for the same purchase), add {from, into} to merges.
Then look at the unsorted tabs. If one clearly belongs to a cluster, add {tabId, key} to assignments. Leave the rest out.
Use only cluster keys you were given. Return empty arrays when nothing applies.`;

/** Compact text description of the clusters, kept small so on-device models fit it in context. */
export function buildUserPrompt(clusters: NamerCluster[], unsorted: NamerCluster['tabs'], summaryWords = 40): string {
  const tab = (t: NamerCluster['tabs'][number]) =>
    `  - [${t.id}] ${t.title.slice(0, 110)} (${t.site}, ${t.pageType})${t.summary ? ` — ${t.summary.split(/\s+/).slice(0, summaryWords).join(' ')}` : ''}`;
  const parts = clusters.map((c) => `Cluster ${c.key} (suggested: ${c.suggestedName})\n${c.tabs.slice(0, 15).map(tab).join('\n')}`);
  if (unsorted.length) parts.push(`Unsorted tabs\n${unsorted.slice(0, 40).map(tab).join('\n')}`);
  return parts.join('\n\n');
}

export const SUMMARY_PROMPT = `You explain a web page to the person who has it open in a browser tab.
Return:
- summary: at most two plain sentences on what the page is and what it offers. No marketing language, no "This page".
- topics: 3 to 5 short lowercase topic tags.`;

export function sanitize(res: z.infer<typeof NamerSchema>, clusters: NamerCluster[]): NamerResult {
  const keys = new Set(clusters.map((c) => c.key));
  return {
    missions: res.missions
      .filter((m) => keys.has(m.key) && m.name.trim())
      .map((m) => ({ ...m, name: m.name.trim().replace(/[.!]+$/, '').slice(0, 48), confidence: Math.max(0, Math.min(1, m.confidence)) })),
    assignments: res.assignments.filter((a) => keys.has(a.key)),
    merges: (res.merges ?? []).filter((m) => keys.has(m.from) && keys.has(m.into) && m.from !== m.into),
  };
}

import type { Settings } from '../settings';
import type { Analysis, Mission, MissionKind, PageType, PlanItem, Rule, TabState, TabVerdict, TabView } from '../types';
import { centroid, type Vector } from '../text';
import { clusterTabs, describe, type Cluster, type Descriptor } from './cluster';
import { colorFor, heuristicName, inferKind, intentLine, missionInsight, slug } from './naming';
import { deriveState, engagementScores, findDuplicates } from './states';

export const UNSORTED_ID = 'unsorted';

export interface NamerCluster {
  key: string;
  tabs: { id: number; title: string; site: string; pageType: PageType; summary: string }[];
  suggestedName: string;
}

export interface NamerResult {
  missions: { key: string; name: string; intent?: string; kind?: MissionKind; confidence?: number }[];
  /** Tabs from "Unsorted" the model placed into a mission. */
  assignments?: { tabId: number; key: string }[];
}

export type Namer = (clusters: NamerCluster[], unsorted: NamerCluster['tabs']) => Promise<NamerResult>;

export interface AnalyzeInput {
  tabs: TabView[];
  rules: Rule[];
  groups: Map<number, { title: string; color?: chrome.tabGroups.Color }>;
  settings: Settings;
  now?: number;
  namer?: Namer;
  engine?: Analysis['engine'];
}

const STATES: TabState[] = ['active', 'simmering', 'stale', 'abandoned', 'unfinished', 'duplicate', 'protected', 'no-history'];

export async function analyze(input: AnalyzeInput): Promise<Analysis> {
  const started = performance.now();
  const now = input.now ?? Date.now();
  const { settings } = input;
  const tabs = input.tabs.filter((t) => !t.incognito || settings.privacy.trackIncognito);

  const descs = new Map<number, Descriptor>(tabs.map((t) => [t.id, describe(t)]));
  const engagement = engagementScores(tabs, settings.weights);
  const dupes = findDuplicates(tabs);
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const windowOrder = [...new Set(tabs.map((t) => t.windowId))].sort((a, b) => a - b);

  // States and verdicts.
  const verdicts: Record<number, TabVerdict> = {};
  for (const t of tabs) {
    const primaryId = dupes.get(t.id);
    const primary = primaryId !== undefined ? byId.get(primaryId) : undefined;
    const dupLabel = primary
      ? primary.windowId === t.windowId
        ? 'this window'
        : windowOrder.length > 1
          ? `window ${windowOrder.indexOf(primary.windowId) + 1}`
          : 'another window'
      : undefined;
    const s = deriveState(t, {
      now,
      settings,
      engagement: engagement.get(t.id) ?? 0,
      duplicateOf: primaryId,
      duplicateLabel: dupLabel,
      pageType: descs.get(t.id)!.pageType,
      installedAt: settings.installedAt || now,
    });
    verdicts[t.id] = {
      tabId: t.id,
      state: s.state,
      flags: s.flags,
      engagement: engagement.get(t.id) ?? 0,
      verdict: s.verdict,
      reasons: s.reasons,
      missionId: UNSORTED_ID,
      evidence: [],
      pageType: descs.get(t.id)!.pageType,
      duplicateOf: s.duplicateOf,
    };
  }

  // Missions.
  let clusters = clusterTabs(tabs, descs, { rules: input.rules, similarity: settings.similarity, groups: input.groups });
  const confident = clusters.filter((c) => c.confidence >= settings.confidenceThreshold || c.fixedName);
  let unsortedIds = clusters.filter((c) => !confident.includes(c)).flatMap((c) => c.tabIds);
  clusters = confident;

  const names = new Map<string, { name: string; intent?: string; kind?: MissionKind; confidence?: number; source: Mission['source'] }>();
  for (const c of clusters) {
    const ds = c.tabIds.map((id) => descs.get(id)!);
    names.set(c.key, {
      name: c.fixedName ?? heuristicName(ds, c.centroid),
      source: c.source === 'rule' ? 'rule' : c.source === 'user' ? 'user' : 'heuristic',
    });
  }

  let engine: Analysis['engine'] = 'heuristic';
  if (input.namer) {
    const free = clusters.filter((c) => c.source === 'similarity');
    const toNamer = (id: number) => {
      const d = descs.get(id)!;
      return { id, title: d.title, site: d.site, pageType: d.pageType, summary: d.summary.slice(0, 600) };
    };
    try {
      const res = await input.namer(
        free.map((c) => ({ key: c.key, tabs: c.tabIds.map(toNamer), suggestedName: names.get(c.key)!.name })),
        unsortedIds.map(toNamer),
      );
      for (const m of res.missions) {
        if (!names.has(m.key) || clusters.find((c) => c.key === m.key)?.source !== 'similarity') continue;
        names.set(m.key, { name: m.name, intent: m.intent, kind: m.kind, confidence: m.confidence, source: 'model' });
      }
      for (const a of res.assignments ?? []) {
        const c = clusters.find((x) => x.key === a.key);
        if (!c || !unsortedIds.includes(a.tabId)) continue;
        c.tabIds.push(a.tabId);
        c.evidence.set(a.tabId, [{ code: 'model', text: 'The AI model placed it here based on its content' }]);
        unsortedIds = unsortedIds.filter((id) => id !== a.tabId);
      }
      engine = input.engine ?? 'nano';
    } catch (err) {
      console.warn('[TabLens] AI naming failed, using heuristics', err);
    }
  }

  // Merge clusters that ended up with the same name (e.g. a rule and a similarity cluster).
  const missionsByName = new Map<string, Mission>();
  const vecs = new Map<string, Vector>();
  for (const c of clusters) {
    const meta = names.get(c.key)!;
    const key = meta.name.trim().toLowerCase();
    const existing = missionsByName.get(key);
    if (existing) {
      existing.tabIds.push(...c.tabIds);
      vecs.set(key, centroid([vecs.get(key)!, c.centroid]));
    } else {
      missionsByName.set(key, {
        id: slug(meta.name),
        name: meta.name,
        intent: meta.intent ?? '',
        kind: meta.kind ?? 'personal',
        color: input.groups.get(c.groupId ?? -1)?.color ?? colorFor(meta.name),
        tabIds: [...c.tabIds],
        confidence: meta.confidence ?? c.confidence,
        source: meta.source,
        keywords: [],
        groupId: c.groupId,
      });
      vecs.set(key, c.centroid);
    }
    for (const id of c.tabIds) verdicts[id]!.evidence = c.evidence.get(id) ?? [];
  }

  const missions: Mission[] = [];
  const usedIds = new Set<string>();
  for (const [key, m] of missionsByName) {
    let id = m.id;
    for (let i = 2; usedIds.has(id); i++) id = `${m.id}-${i}`;
    usedIds.add(id);
    m.id = id;
    const mt = m.tabIds.map((tid) => byId.get(tid)!);
    const ds = m.tabIds.map((tid) => descs.get(tid)!);
    const c = vecs.get(key)!;
    if (!m.intent) m.intent = intentLine(mt, ds, c);
    if (m.source !== 'model') m.kind = inferKind(ds);
    m.keywords = [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
    m.insight = missionInsight(mt, ds, verdicts);
    // Already mirrored to a single Chrome group?
    if (m.groupId === undefined) {
      const gids = new Set(mt.map((t) => t.groupId));
      if (gids.size === 1 && [...gids][0]! >= 0) m.groupId = [...gids][0];
    }
    for (const tid of m.tabIds) {
      verdicts[tid]!.missionId = id;
      if (!verdicts[tid]!.evidence.length) verdicts[tid]!.evidence = [{ code: 'similar', text: 'Its title and content are closest to this mission' }];
    }
    missions.push(m);
  }

  if (unsortedIds.length) {
    for (const id of unsortedIds) {
      verdicts[id]!.missionId = UNSORTED_ID;
      verdicts[id]!.evidence = [{ code: 'unsorted', text: 'Not similar enough to any mission to place it with confidence' }];
    }
    missions.push({
      id: UNSORTED_ID,
      name: 'Unsorted',
      intent: 'Tabs TabLens could not place with confidence. Drag them into a mission to teach it.',
      kind: 'personal',
      color: 'grey',
      tabIds: unsortedIds,
      confidence: 0,
      source: 'heuristic',
      keywords: [],
    });
  }

  // Most "can go" first, Unsorted last.
  const canGo = (m: Mission) => m.tabIds.filter((id) => verdicts[id]!.verdict === 'archive' || verdicts[id]!.verdict === 'close-duplicate').length;
  missions.sort((a, b) => Number(a.id === UNSORTED_ID) - Number(b.id === UNSORTED_ID) || canGo(b) - canGo(a) || b.tabIds.length - a.tabIds.length);

  const counts = Object.fromEntries(STATES.map((s) => [s, 0])) as Analysis['counts'];
  for (const v of Object.values(verdicts)) counts[v.state]++;
  counts.total = tabs.length;
  counts.canGo = Object.values(verdicts).filter((v) => v.verdict === 'archive' || v.verdict === 'close-duplicate').length;

  return {
    id: 'a' + now.toString(36),
    createdAt: now,
    durationMs: Math.round(performance.now() - started),
    engine,
    missions,
    verdicts,
    plan: buildPlan(missions, verdicts, byId),
    counts,
  };
}

export function buildPlan(missions: Mission[], verdicts: Record<number, TabVerdict>, tabs: Map<number, TabView>): PlanItem[] {
  const by = (state: TabState) => Object.values(verdicts).filter((v) => v.state === state).map((v) => v.tabId);
  const plan: PlanItem[] = [];
  const dupes = by('duplicate');
  if (dupes.length)
    plan.push({ id: 'close-duplicates', kind: 'close-duplicates', label: `Close ${dupes.length} duplicate${dupes.length === 1 ? '' : 's'}`, tabIds: dupes, recommended: true });
  const abandoned = by('abandoned');
  if (abandoned.length)
    plan.push({ id: 'archive-abandoned', kind: 'archive-abandoned', label: `Archive ${abandoned.length} abandoned`, tabIds: abandoned, recommended: true });
  const stale = by('stale');
  if (stale.length) plan.push({ id: 'archive-stale', kind: 'archive-stale', label: `Archive ${stale.length} stale`, tabIds: stale, recommended: false });

  const leaving = new Set([...dupes, ...abandoned]);
  const toGroup = missions.filter((m) => {
    if (m.id === UNSORTED_ID) return false;
    const staying = m.tabIds.filter((id) => !leaving.has(id));
    if (staying.length < 2) return false;
    const gids = new Set(staying.map((id) => tabs.get(id)?.groupId));
    return !(gids.size === 1 && m.groupId !== undefined && [...gids][0] === m.groupId);
  });
  if (toGroup.length)
    plan.push({
      id: 'group-missions',
      kind: 'group-missions',
      label: `Group ${toGroup.length} mission${toGroup.length === 1 ? '' : 's'}`,
      tabIds: toGroup.flatMap((m) => m.tabIds.filter((id) => !leaving.has(id))),
      missionIds: toGroup.map((m) => m.id),
      recommended: true,
    });
  return plan;
}

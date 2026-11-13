import type { GroupColor } from '../types';
import type { Settings } from '../settings';
import type { Analysis, Mission, MissionKind, PageType, PlanItem, Reason, Rule, TabState, TabVerdict, TabView } from '../types';
import { centroid, type Vector } from '../text';
import { clusterTabs, describe, type Cluster, type Descriptor } from './cluster';
import { LIMITS, type OrganizeOutput, type OrganizeRequest } from '../ai/contract';
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
  /** Clusters the model judged to be the same mission. */
  merges?: { from: string; into: string }[];
}

export type Namer = (clusters: NamerCluster[], unsorted: NamerCluster['tabs']) => Promise<NamerResult>;

/** LLM-first organisation: the model assigns every free tab to a mission (see ai/contract.ts). */
export type Organizer = (req: OrganizeRequest) => Promise<OrganizeOutput>;

export interface AnalyzeInput {
  tabs: TabView[];
  rules: Rule[];
  groups: Map<number, { title: string; color?: GroupColor }>;
  settings: Settings;
  now?: number;
  namer?: Namer;
  /** When set, the model decides the missions; heuristics only provide hints and the fallback. */
  organizer?: Organizer;
  engine?: Analysis['engine'];
  /**
   * Missions from the previous run. A new cluster that mostly overlaps a previous mission keeps its
   * name, so missions don't get renamed every time a tab opens. With `sticky: 'user'` only names the
   * user gave are kept (used for a fresh AI run).
   */
  previous?: Mission[];
  sticky?: 'all' | 'user';
}

function stickyMatch(tabIds: number[], previous: Mission[] | undefined, sticky: 'all' | 'user', ruleNames: Set<string>): Mission | undefined {
  if (!previous?.length) return undefined;
  const ids = new Set(tabIds);
  let best: Mission | undefined;
  let bestScore = 0;
  for (const m of previous) {
    if (m.id === UNSORTED_ID) continue;
    // Names the user gave, or that their board moves point at, always stick; model names stick between AI runs.
    const userOwned = m.source === 'user' || ruleNames.has(m.name);
    if (sticky === 'user' ? !userOwned : m.source === 'heuristic' && !userOwned) continue;
    const overlap = m.tabIds.filter((id) => ids.has(id)).length;
    const score = overlap / Math.max(ids.size, m.tabIds.length);
    if (score >= 0.5 && score > bestScore) [best, bestScore] = [m, score];
  }
  return best;
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
  const clustered = clusterTabs(tabs, descs, { rules: input.rules, similarity: settings.similarity, groups: input.groups });
  let clusters = clustered.clusters;
  let unsortedIds: number[] = [];
  let engine: Analysis['engine'] = 'heuristic';

  // LLM-first: the organiser decides missions for every tab the user hasn't placed themselves.
  let organized = false;
  if (input.organizer) {
    const result = await organizeWithModel(input, clusters, clustered.vectors, descs);
    if (result) {
      clusters = result.clusters;
      unsortedIds = result.unsorted;
      organized = true;
      engine = input.engine ?? 'cloud';
    }
  }
  if (!organized) {
    const confident = clusters.filter((c) => c.confidence >= settings.confidenceThreshold || c.fixedName);
    unsortedIds = clusters.filter((c) => !confident.includes(c)).flatMap((c) => c.tabIds);
    clusters = confident;
  }

  const names = new Map<string, { name: string; intent?: string; kind?: MissionKind; confidence?: number; source: Mission['source'] }>();
  const stuck = new Set<string>();
  const ruleNames = new Set(input.rules.map((r) => r.missionName));
  for (const c of clusters) {
    const ds = c.tabIds.map((id) => descs.get(id)!);
    const prev = c.source === 'similarity' ? stickyMatch(c.tabIds, input.previous, input.sticky ?? 'all', ruleNames) : undefined;
    if (prev) {
      stuck.add(c.key);
      names.set(c.key, { name: prev.name, intent: prev.source === 'model' ? prev.intent : undefined, kind: prev.kind, source: prev.source });
      continue;
    }
    if (c.source === 'model') {
      const meta = c.model!;
      names.set(c.key, { name: c.fixedName!, intent: meta.intent, kind: meta.kind, confidence: meta.confidence, source: 'model' });
      continue;
    }
    names.set(c.key, {
      name: c.fixedName ?? heuristicName(ds, c.centroid),
      source: c.source === 'rule' ? 'rule' : c.source === 'user' ? 'user' : 'heuristic',
    });
  }

  if (input.namer && !organized) {
    const free = clusters.filter((c) => c.source === 'similarity' && !stuck.has(c.key));
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
      for (const mg of res.merges ?? []) {
        const from = clusters.find((x) => x.key === mg.from && x.source === 'similarity');
        const into = clusters.find((x) => x.key === mg.into);
        if (!from || !into || from === into) continue;
        into.tabIds.push(...from.tabIds);
        for (const id of from.tabIds) into.evidence.set(id, [...(from.evidence.get(id) ?? []), { code: 'model', text: 'Gemini judged it part of the same task' }]);
        into.centroid = centroid([into.centroid, from.centroid]);
        clusters = clusters.filter((x) => x !== from);
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
    if (m.source !== 'model' && m.source !== 'user') m.kind = inferKind(ds);
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
    plan: buildPlan(missions, verdicts, byId, input.groups),
    counts,
  };
}

/**
 * Runs the organiser and turns its answer into clusters. Missions the user owns (their Chrome groups,
 * rules, names they gave) stay fixed: the model can add tabs to them by name but not take tabs away.
 * Returns null when the model fails, so the caller falls back to heuristics.
 */
async function organizeWithModel(input: AnalyzeInput, clusters: Cluster[], vectors: Map<number, Vector>, descs: Map<number, Descriptor>): Promise<{ clusters: Cluster[]; unsorted: number[] } | null> {
  const fixed = clusters.filter((c) => c.fixedName);
  const free = clusters.filter((c) => !c.fixedName);
  const freeIds = free.flatMap((c) => c.tabIds).slice(0, LIMITS.organizeTabs);
  if (!freeIds.length) return null;
  const hintOf = new Map<number, string>();
  for (const c of free) if (c.tabIds.length > 1) for (const id of c.tabIds) hintOf.set(id, `g${free.indexOf(c) + 1}`);
  const userNames = (input.previous ?? []).filter((m) => m.source === 'user' && m.id !== UNSORTED_ID).map((m) => m.name);
  const fixedNames = [...new Set([...fixed.map((c) => c.fixedName!), ...userNames])].slice(0, LIMITS.fixedMissions);
  const req: OrganizeRequest = {
    tabs: freeIds.map((id) => {
      const d = descs.get(id)!;
      return { id, title: d.title.slice(0, LIMITS.title), site: d.site.slice(0, LIMITS.site), pageType: d.pageType, summary: d.summary.slice(0, LIMITS.organizeSummary), hint: hintOf.get(id) };
    }),
    fixed: fixedNames.map((name) => ({
      name: name.slice(0, LIMITS.name),
      examples: (fixed.find((c) => c.fixedName === name)?.tabIds ?? []).slice(0, 3).map((id) => descs.get(id)!.title.slice(0, LIMITS.title)),
    })),
    previous: [...new Set((input.previous ?? []).filter((m) => m.source === 'model').map((m) => m.name))].slice(0, LIMITS.fixedMissions),
  };
  let res: OrganizeOutput;
  try {
    res = await input.organizer!(req);
  } catch (err) {
    console.warn('[TabLens] AI organisation failed, using heuristics', err);
    return null;
  }

  const allowed = new Set(freeIds);
  const placed = new Set<number>();
  const heuristicEvidence = new Map<number, Reason[]>();
  for (const c of free) for (const id of c.tabIds) heuristicEvidence.set(id, c.evidence.get(id) ?? []);
  const out: Cluster[] = fixed.map((c) => ({ ...c, tabIds: [...c.tabIds], evidence: new Map(c.evidence) }));

  for (const m of res.missions) {
    const ids = m.tabIds.filter((id) => allowed.has(id) && !placed.has(id));
    if (!ids.length) continue;
    ids.forEach((id) => placed.add(id));
    const target = out.find((c) => c.fixedName && c.fixedName.toLowerCase() === m.name.toLowerCase());
    if (target) {
      for (const id of ids) {
        target.tabIds.push(id);
        target.evidence.set(id, [{ code: 'model', text: `Gemini put it in your mission “${target.fixedName}”` }, ...(heuristicEvidence.get(id) ?? [])]);
      }
      target.centroid = centroid(target.tabIds.map((id) => vectors.get(id)!));
      continue;
    }
    // A user-named mission that isn't a Chrome group or rule yet (renamed on the board).
    const evidence = new Map(ids.map((id) => [id, [{ code: 'model', text: 'Gemini grouped it here from its title and content' }, ...(heuristicEvidence.get(id) ?? []).filter((r) => r.code !== 'terms')]]));
    out.push({
      key: 'ai:' + m.name.toLowerCase(),
      tabIds: ids,
      fixedName: m.name,
      source: userNames.includes(m.name) ? 'user' : 'model',
      confidence: m.confidence,
      centroid: centroid(ids.map((id) => vectors.get(id)!)),
      evidence,
      model: { intent: m.intent, kind: m.kind, confidence: m.confidence },
    });
  }
  // Tabs over the request limit, and any the model left out, go to Unsorted.
  const overflow = free.flatMap((c) => c.tabIds).filter((id) => !allowed.has(id));
  return { clusters: out, unsorted: [...freeIds.filter((id) => !placed.has(id)), ...overflow] };
}

/**
 * A mission counts as grouped when every tab that can be grouped (not pinned) sits in a Chrome group
 * carrying the mission's name — one group, or one per window.
 */
export function isMissionGrouped(m: Pick<Mission, 'name'>, tabs: { groupId: number; pinned: boolean }[], groups: Map<number, { title: string }>): boolean {
  const groupable = tabs.filter((t) => !t.pinned);
  return groupable.length > 0 && groupable.every((t) => t.groupId >= 0 && groups.get(t.groupId)?.title === m.name);
}

export function buildPlan(missions: Mission[], verdicts: Record<number, TabVerdict>, tabs: Map<number, TabView>, groups: Map<number, { title: string }> = new Map()): PlanItem[] {
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
    const views = staying.map((id) => tabs.get(id)).filter((t): t is TabView => !!t);
    return !isMissionGrouped(m, views, groups);
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

import type { GroupColor } from './types';
import { UNSORTED_ID } from './analysis/analyze';
import { db, uid, type UndoOp } from './db';
import type { UndoResult } from './rpc';
import { editAnalysis, findMission, newMission, reassign } from './service';
import type { Analysis, ArchiveEntry, Mission, Rule } from './types';
import { hostnameOf, normalizeUrl } from './url';
import { latestAnalysis } from './db';

/**
 * The only module that changes tabs. Every function runs after an explicit click in a TabLens
 * surface and records the inverse operations so the action can be undone for 30 seconds
 * (archived tabs stay restorable from the Archive afterwards).
 */

const UNDO_TTL = 5 * 60_000;

async function recordUndo(label: string, ops: UndoOp[]): Promise<string> {
  const id = uid('u');
  await db.undo.put({ id, label, createdAt: Date.now(), ops });
  await db.undo.where('createdAt').below(Date.now() - UNDO_TTL).delete();
  return id;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

async function getTabs(ids: number[]): Promise<chrome.tabs.Tab[]> {
  const out = await Promise.all(ids.map((id) => chrome.tabs.get(id).catch(() => undefined)));
  return out.filter((t): t is chrome.tabs.Tab => !!t);
}

async function groupInfo(groupId: number | undefined) {
  if (groupId === undefined || groupId < 0) return undefined;
  return chrome.tabGroups.get(groupId).catch(() => undefined);
}

async function reopenSpec(tabs: chrome.tabs.Tab[]) {
  return Promise.all(
    tabs.map(async (t) => {
      const g = await groupInfo(t.groupId);
      return { url: t.url ?? '', windowId: t.windowId, index: t.index, pinned: t.pinned, groupKey: g ? JSON.stringify({ title: g.title, color: g.color }) : undefined };
    }),
  );
}

/** Closes tabs and stores them in the Archive. */
export async function archiveTabs(tabIds: number[], opts: { reason?: string; label?: string; snoozeUntil?: number } = {}): Promise<UndoResult> {
  const tabs = (await getTabs(tabIds)).filter((t) => t.url);
  if (!tabs.length) return { count: 0, message: 'Nothing to archive' };
  const a = await latestAnalysis();
  const batchId = uid('b');
  const now = Date.now();
  const entries: ArchiveEntry[] = tabs.map((t) => {
    const v = a?.verdicts[t.id!];
    const m = v ? a?.missions.find((x) => x.id === v.missionId) : undefined;
    return {
      id: uid('ar'),
      url: t.url!,
      title: t.title || t.url!,
      favIconUrl: t.favIconUrl,
      missionName: m && m.id !== UNSORTED_ID ? m.name : undefined,
      archivedAt: now,
      lastState: v?.state,
      reason: opts.reason ?? v?.reasons[0]?.text,
      snoozeUntil: opts.snoozeUntil,
      batchId,
    };
  });
  const spec = await reopenSpec(tabs);
  await db.archive.bulkPut(entries);
  await chrome.tabs.remove(tabs.map((t) => t.id!));
  if (opts.snoozeUntil) await chrome.alarms.create(`snooze:${batchId}`, { when: opts.snoozeUntil });
  const verb = opts.snoozeUntil ? 'Snoozed' : 'Archived';
  const message = opts.label ?? `${verb} ${plural(tabs.length, 'tab')}`;
  const undoId = await recordUndo(message, [{ kind: 'reopen', tabs: spec, archiveIds: entries.map((e) => e.id) }]);
  return { undoId, count: tabs.length, message };
}

/** Closes tabs without archiving them (used for duplicates: the other copy stays open). */
export async function closeTabs(tabIds: number[], label?: string): Promise<UndoResult> {
  const tabs = (await getTabs(tabIds)).filter((t) => !t.pinned);
  if (!tabs.length) return { count: 0, message: 'Nothing to close' };
  const spec = await reopenSpec(tabs);
  await chrome.tabs.remove(tabs.map((t) => t.id!));
  const message = label ?? `Closed ${plural(tabs.length, 'duplicate')}`;
  const undoId = await recordUndo(message, [{ kind: 'reopen', tabs: spec, archiveIds: [] }]);
  return { undoId, count: tabs.length, message };
}

/** Puts a mission's tabs into one Chrome tab group (moving tabs across windows if needed). */
async function groupMissionTabs(m: Mission, _a?: Analysis): Promise<{ ops: UndoOp[]; count: number; groupId?: number }> {
  const tabs = (await getTabs(m.tabIds)).filter((t) => !t.pinned);
  if (!tabs.length) return { ops: [], count: 0 };
  const before = tabs.map((t) => ({ tabId: t.id!, groupId: t.groupId ?? -1, windowId: t.windowId, index: t.index }));
  const created: number[] = [];

  let group = await groupInfo(m.groupId);
  if (!group) {
    // Reuse a group that already has this title, else target the window holding most of the tabs.
    const all = await chrome.tabGroups.query({ title: m.name });
    group = all[0];
  }
  let windowId = group?.windowId;
  if (windowId === undefined) {
    const counts = new Map<number, number>();
    for (const t of tabs) counts.set(t.windowId, (counts.get(t.windowId) ?? 0) + 1);
    windowId = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]![0];
  }
  const strays = tabs.filter((t) => t.windowId !== windowId).map((t) => t.id!);
  if (strays.length) await chrome.tabs.move(strays, { windowId, index: -1 });
  const ids = tabs.map((t) => t.id!) as [number, ...number[]];
  const groupId = group ? await chrome.tabs.group({ tabIds: ids, groupId: group.id }) : await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
  if (!group) created.push(groupId);
  const prevGroup = group ? { groupId: group.id, title: group.title, color: group.color as GroupColor, collapsed: group.collapsed } : undefined;
  await chrome.tabGroups.update(groupId, { title: m.name, color: m.color as chrome.tabGroups.Color });
  m.groupId = groupId;
  const ops: UndoOp[] = [{ kind: 'regroup', moves: before }];
  if (created.length) ops.push({ kind: 'ungroup-created', groupIds: created });
  if (prevGroup) ops.push({ kind: 'restore-groups', groups: [prevGroup] });
  return { ops, count: tabs.length, groupId };
}

export async function groupMissions(missionIds: string[]): Promise<UndoResult> {
  const ops: UndoOp[] = [];
  let count = 0;
  let groups = 0;
  await editAnalysis(() => {}); // ensure plan is fresh
  const a = await latestAnalysis();
  if (!a) throw new Error('Run an analysis first.');
  for (const id of missionIds) {
    const m = findMission(a, id);
    if (!m || m.id === UNSORTED_ID) continue;
    const r = await groupMissionTabs(m, a);
    ops.push(...r.ops);
    count += r.count;
    if (r.count) groups++;
  }
  await db.analyses.put(a);
  const message = `Grouped ${plural(count, 'tab')} into ${plural(groups, 'mission')}`;
  return { undoId: ops.length ? await recordUndo(message, ops) : undefined, count, message };
}

export async function applyPlan(p: { closeIds: number[]; archiveIds: number[]; groupMissionIds: string[] }): Promise<UndoResult> {
  const ops: UndoOp[] = [];
  const parts: string[] = [];
  let count = 0;
  if (p.closeIds.length) {
    const r = await closeTabs(p.closeIds);
    if (r.undoId) ops.push(...((await db.undo.get(r.undoId))?.ops ?? []));
    if (r.count) parts.push(`closed ${plural(r.count, 'duplicate')}`);
    count += r.count;
  }
  if (p.archiveIds.length) {
    const r = await archiveTabs(p.archiveIds);
    if (r.undoId) ops.push(...((await db.undo.get(r.undoId))?.ops ?? []));
    if (r.count) parts.push(`archived ${plural(r.count, 'tab')}`);
    count += r.count;
  }
  if (p.groupMissionIds.length) {
    const r = await groupMissions(p.groupMissionIds);
    if (r.undoId) ops.push(...((await db.undo.get(r.undoId))?.ops ?? []));
    if (r.count) parts.push(`grouped ${plural(p.groupMissionIds.length, 'mission')}`);
  }
  const message = parts.length ? parts.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'Nothing to do';
  // Undo of a plan reverses group changes first, then reopens closed tabs.
  const undoId = ops.length ? await recordUndo(message, ops) : undefined;
  return { undoId, count, message };
}

function ruleFor(url: string, remember: 'url' | 'domain', missionName: string): Rule {
  const norm = normalizeUrl(url);
  return {
    id: uid('r'),
    kind: remember === 'domain' ? 'domain' : 'url-prefix',
    pattern: remember === 'domain' ? hostnameOf(url) : norm.replace(/^https?:\/\//, ''),
    missionName,
    createdFrom: 'Moved on the missions board',
    createdAt: Date.now(),
  };
}

/** Drag and drop on the board: moves the real tab into the mission's Chrome group and remembers it. */
export async function moveTabToMission(tabId: number, missionId: string, beforeTabId?: number, remember: 'url' | 'domain' = 'url'): Promise<UndoResult> {
  const tab = await chrome.tabs.get(tabId);
  const a = await latestAnalysis();
  if (!a) throw new Error('Run an analysis first.');
  let ops: UndoOp[] = [{ kind: 'regroup', moves: [{ tabId, groupId: tab.groupId ?? -1, windowId: tab.windowId, index: tab.index }] }];

  if (missionId === UNSORTED_ID) {
    if ((tab.groupId ?? -1) >= 0) await chrome.tabs.ungroup(tabId);
    reassign(a, tabId, UNSORTED_ID);
  } else {
    const m = findMission(a, missionId);
    if (!m) throw new Error('That mission no longer exists. Re-analyse and try again.');
    reassign(a, tabId, missionId, beforeTabId);
    // The mission now includes the dropped tab, so this captures its previous position too.
    ops = (await groupMissionTabs(m, a)).ops;
    // Reorder within the group to match the card position.
    if (beforeTabId !== undefined) {
      const target = await chrome.tabs.get(beforeTabId).catch(() => undefined);
      const self = await chrome.tabs.get(tabId);
      if (target && target.windowId === self.windowId) await chrome.tabs.move(tabId, { index: self.index < target.index ? target.index - 1 : target.index });
    }
    if (tab.url) {
      const rule = ruleFor(tab.url, remember, m.name);
      // Replace older rules for the same pattern.
      await db.rules.where('pattern').equals(rule.pattern).delete();
      await db.rules.put(rule);
      ops.push({ kind: 'delete-rules', ruleIds: [rule.id] });
    }
  }
  await db.analyses.put(a);
  const target = findMission(a, missionId);
  const message = `Moved to ${target?.name ?? 'Unsorted'}`;
  return { undoId: await recordUndo(message, ops), count: 1, message };
}

export async function createMission(name: string, tabIds: number[]): Promise<{ missionId: string }> {
  const a = await latestAnalysis();
  if (!a) throw new Error('Run an analysis first.');
  const m = newMission(a, name.trim() || 'New mission');
  for (const id of tabIds) reassign(a, id, m.id);
  await db.analyses.put(a);
  if (tabIds.length) await groupMissions([m.id]);
  return { missionId: m.id };
}

export async function renameMission(missionId: string, name: string) {
  let groupId: number | undefined;
  let oldName = '';
  await editAnalysis((a) => {
    const m = findMission(a, missionId);
    if (!m) return;
    oldName = m.name;
    m.name = name.trim();
    m.source = 'user';
    groupId = m.groupId;
  });
  if (oldName) await db.rules.where('missionName').equals(oldName).modify({ missionName: name.trim() });
  if (groupId !== undefined && (await groupInfo(groupId))) await chrome.tabGroups.update(groupId, { title: name.trim() });
}

export async function recolorMission(missionId: string, color: GroupColor) {
  let groupId: number | undefined;
  await editAnalysis((a) => {
    const m = findMission(a, missionId);
    if (!m) return;
    m.color = color;
    groupId = m.groupId;
  });
  if (groupId !== undefined && (await groupInfo(groupId))) await chrome.tabGroups.update(groupId, { color: color as chrome.tabGroups.Color });
}

export async function mergeMissions(fromId: string, intoId: string): Promise<UndoResult> {
  const a = await latestAnalysis();
  const from = a && findMission(a, fromId);
  const into = a && findMission(a, intoId);
  if (!a || !from || !into) throw new Error('Mission not found.');
  const ids = [...from.tabIds];
  for (const id of ids) reassign(a, id, intoId);
  a.missions = a.missions.filter((m) => m.id !== fromId);
  into.source = 'user';
  await db.analyses.put(a);
  const rules: Rule[] = ids.length ? (await db.rules.where('missionName').equals(from.name).toArray()) : [];
  await db.rules.bulkPut(rules.map((r) => ({ ...r, missionName: into.name })));
  const r = into.groupId !== undefined || from.groupId !== undefined ? await groupMissions([intoId]) : { count: ids.length, undoId: undefined };
  const message = `Merged ${from.name} into ${into.name}`;
  return { undoId: r.undoId, count: ids.length, message };
}

export async function archiveMission(missionId: string, onlyStale = false): Promise<UndoResult> {
  const a = await latestAnalysis();
  const m = a && findMission(a, missionId);
  if (!a || !m) throw new Error('Mission not found.');
  const ids = m.tabIds.filter((id) => {
    const v = a.verdicts[id];
    if (!v) return !onlyStale;
    if (v.state === 'protected' || v.state === 'unfinished') return false;
    return onlyStale ? v.verdict === 'archive' || v.verdict === 'close-duplicate' : true;
  });
  const skipped = m.tabIds.length - ids.length;
  const r = await archiveTabs(ids, { label: `Archived ${plural(ids.length, 'tab')} from ${m.name}` });
  return { ...r, message: r.message + (skipped && !onlyStale ? ` · kept ${skipped} protected or unfinished` : '') };
}

const FOCUS_KEY = 'focusState';

/** Focus mode: group the mission, collapse every other group in its window, and jump to it. */
export async function focusMission(missionId: string | null): Promise<{ focused: string | null }> {
  const prev = (await chrome.storage.session.get(FOCUS_KEY))[FOCUS_KEY] as { missionId: string; collapsed: { id: number; collapsed: boolean }[] } | undefined;
  if (prev) {
    for (const g of prev.collapsed) await chrome.tabGroups.update(g.id, { collapsed: g.collapsed }).catch(() => {});
    await chrome.storage.session.remove(FOCUS_KEY);
  }
  if (!missionId) return { focused: null };
  await groupMissions([missionId]);
  const a = await latestAnalysis();
  const m = a && findMission(a, missionId);
  if (!m?.groupId) return { focused: null };
  const g = await chrome.tabGroups.get(m.groupId);
  const others = (await chrome.tabGroups.query({ windowId: g.windowId })).filter((x) => x.id !== g.id);
  await chrome.storage.session.set({ [FOCUS_KEY]: { missionId, collapsed: [...others.map((o) => ({ id: o.id, collapsed: o.collapsed })), { id: g.id, collapsed: g.collapsed }] } });
  for (const o of others) await chrome.tabGroups.update(o.id, { collapsed: true });
  await chrome.tabGroups.update(g.id, { collapsed: false });
  const [first] = await chrome.tabs.query({ groupId: g.id });
  if (first?.id) await openTab(first.id);
  return { focused: missionId };
}

export async function getFocusedMission(): Promise<string | null> {
  const s = (await chrome.storage.session.get(FOCUS_KEY))[FOCUS_KEY] as { missionId: string } | undefined;
  return s?.missionId ?? null;
}

export async function openTab(tabId: number) {
  const t = await chrome.tabs.update(tabId, { active: true });
  if (t?.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true });
}

export async function setKeep(tabIds: number[], keep: boolean) {
  await db.tabs.where('tabId').anyOf(tabIds).modify({ keep });
  await editAnalysis((a) => {
    for (const id of tabIds) {
      const v = a.verdicts[id];
      if (!v) continue;
      if (keep) {
        v.state = 'protected';
        v.verdict = 'keep';
        v.reasons = [{ code: 'keep', text: 'You marked it Keep' }];
      } else if (v.state === 'protected') {
        v.reasons = [{ code: 'unkeep', text: 'Keep removed — re-analyse to refresh its state' }];
      }
    }
  });
}

/** Restores archived entries, optionally into a new window, regrouping by mission name. */
export async function restoreArchive(ids: string[], newWindow = false): Promise<{ opened: number }> {
  const entries = (await db.archive.bulkGet(ids)).filter((e): e is ArchiveEntry => !!e);
  if (!entries.length) return { opened: 0 };
  let windowId: number | undefined;
  if (newWindow) {
    const w = await chrome.windows.create({ url: entries[0]!.url, focused: true });
    windowId = w?.id;
  }
  const opened: { id: number; mission?: string }[] = [];
  for (const [i, e] of entries.entries()) {
    if (newWindow && i === 0) {
      const [t] = await chrome.tabs.query({ windowId });
      if (t?.id) opened.push({ id: t.id, mission: e.missionName });
      continue;
    }
    const t = await chrome.tabs.create({ url: e.url, active: false, windowId });
    if (t.id) opened.push({ id: t.id, mission: e.missionName });
  }
  // Regroup tabs that came from the same mission.
  const byMission = new Map<string, number[]>();
  for (const o of opened) if (o.mission) byMission.set(o.mission, [...(byMission.get(o.mission) ?? []), o.id]);
  for (const [name, tabIds] of byMission) {
    if (tabIds.length < 2) continue;
    const gid = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] });
    await chrome.tabGroups.update(gid, { title: name });
  }
  await db.archive.bulkDelete(entries.map((e) => e.id));
  for (const b of new Set(entries.map((e) => e.batchId))) await chrome.alarms.clear(`snooze:${b}`);
  return { opened: opened.length };
}

export async function wakeSnoozed(batchId: string) {
  const entries = await db.archive.where('batchId').equals(batchId).toArray();
  const due = entries.filter((e) => e.snoozeUntil);
  if (!due.length) return;
  await restoreArchive(due.map((e) => e.id));
  chrome.notifications?.create(`snooze:${batchId}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('/icon/128.png'),
    title: due.length === 1 ? 'Snoozed tab is back' : `${due.length} snoozed tabs are back`,
    message: due.map((e) => e.title).slice(0, 3).join('\n'),
  });
}

export async function undo(undoId: string): Promise<{ ok: boolean }> {
  const entry = await db.undo.get(undoId);
  if (!entry) return { ok: false };
  for (const op of [...entry.ops].reverse()) {
    try {
      await runInverse(op);
    } catch (err) {
      console.warn('[TabLens] undo step failed', op.kind, err);
    }
  }
  await db.undo.delete(undoId);
  return { ok: true };
}

async function runInverse(op: UndoOp) {
  switch (op.kind) {
    case 'reopen': {
      const windows = new Set((await chrome.windows.getAll()).map((w) => w.id));
      const groupIds = new Map<string, number>();
      for (const t of [...op.tabs].sort((x, y) => x.index! - y.index!)) {
        const created = await chrome.tabs.create({
          url: t.url,
          active: false,
          pinned: t.pinned,
          windowId: t.windowId !== undefined && windows.has(t.windowId) ? t.windowId : undefined,
          index: t.windowId !== undefined && windows.has(t.windowId) ? t.index : undefined,
        });
        if (t.groupKey && created.id) {
          const { title, color } = JSON.parse(t.groupKey) as { title?: string; color?: GroupColor };
          const key = `${created.windowId}:${t.groupKey}`;
          let gid = groupIds.get(key);
          if (gid === undefined) {
            const existing = (await chrome.tabGroups.query({ windowId: created.windowId, title })).at(0);
            gid = existing ? await chrome.tabs.group({ tabIds: created.id, groupId: existing.id }) : await chrome.tabs.group({ tabIds: created.id, createProperties: { windowId: created.windowId } });
            if (!existing) await chrome.tabGroups.update(gid, { title, color: color as chrome.tabGroups.Color | undefined });
            groupIds.set(key, gid);
          } else {
            await chrome.tabs.group({ tabIds: created.id, groupId: gid });
          }
        }
      }
      await db.archive.bulkDelete(op.archiveIds);
      break;
    }
    case 'regroup': {
      for (const mv of op.moves) {
        const t = await chrome.tabs.get(mv.tabId).catch(() => undefined);
        if (!t) continue;
        if (t.windowId !== mv.windowId) await chrome.tabs.move(mv.tabId, { windowId: mv.windowId, index: mv.index }).catch(() => {});
        if (mv.groupId >= 0 && (await groupInfo(mv.groupId))) await chrome.tabs.group({ tabIds: mv.tabId, groupId: mv.groupId });
        else if ((t.groupId ?? -1) >= 0) await chrome.tabs.ungroup(mv.tabId);
        await chrome.tabs.move(mv.tabId, { index: mv.index }).catch(() => {});
      }
      break;
    }
    case 'ungroup-created': {
      for (const gid of op.groupIds) {
        const tabs = await chrome.tabs.query({ groupId: gid }).catch(() => []);
        if (tabs.length) await chrome.tabs.ungroup(tabs.map((t) => t.id!) as [number, ...number[]]);
      }
      break;
    }
    case 'restore-groups': {
      for (const g of op.groups) if (await groupInfo(g.groupId)) await chrome.tabGroups.update(g.groupId, { title: g.title, color: g.color as chrome.tabGroups.Color | undefined, collapsed: g.collapsed });
      break;
    }
    case 'delete-rules':
      await db.rules.bulkDelete(op.ruleIds);
      break;
    case 'unkeep':
      await db.tabs.where('tabId').anyOf(op.tabIds).modify({ keep: false });
      break;
    case 'delete-saves':
      await db.saves.bulkDelete(op.saveIds);
      break;
    case 'restore-archive':
      await db.archive.bulkPut(op.entries);
      break;
  }
}

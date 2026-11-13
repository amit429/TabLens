import type { GroupColor } from './types';
import Dexie, { type EntityTable } from 'dexie';
import type { Analysis, ArchiveEntry, BookmarkMeta, Rule, Save, Snapshot, TabRecord } from './types';

export interface UndoEntry {
  id: string;
  label: string;
  createdAt: number;
  ops: UndoOp[];
}

export type UndoOp =
  | { kind: 'reopen'; tabs: { url: string; windowId?: number; index?: number; pinned?: boolean; groupKey?: string }[]; archiveIds: string[] }
  | { kind: 'regroup'; moves: { tabId: number; groupId: number; windowId: number; index: number }[] }
  | { kind: 'ungroup-created'; groupIds: number[] }
  | { kind: 'restore-groups'; groups: { groupId: number; title?: string; color?: GroupColor; collapsed: boolean }[] }
  | { kind: 'delete-rules'; ruleIds: string[] }
  | { kind: 'unkeep'; tabIds: number[] }
  | { kind: 'delete-saves'; saveIds: string[] }
  | { kind: 'restore-archive'; entries: ArchiveEntry[] };

export class TabLensDB extends Dexie {
  tabs!: EntityTable<TabRecord, 'tabId'>;
  snapshots!: EntityTable<Snapshot, 'normUrl'>;
  analyses!: EntityTable<Analysis, 'id'>;
  rules!: EntityTable<Rule, 'id'>;
  archive!: EntityTable<ArchiveEntry, 'id'>;
  saves!: EntityTable<Save, 'id'>;
  bookmarkMeta!: EntityTable<BookmarkMeta, 'bookmarkId'>;
  undo!: EntityTable<UndoEntry, 'id'>;

  constructor() {
    super('tablens');
    this.version(1).stores({
      tabs: 'tabId, normUrl, windowId, lastAccessed',
      snapshots: 'normUrl, capturedAt',
      analyses: 'id, createdAt',
      rules: 'id, pattern, missionName',
      archive: 'id, archivedAt, batchId, snoozeUntil, url',
      saves: 'id, createdAt, url, intent, remindAt',
      bookmarkMeta: 'bookmarkId',
      undo: 'id, createdAt',
    });
  }
}

export const db = new TabLensDB();

export async function latestAnalysis(): Promise<Analysis | undefined> {
  return db.analyses.orderBy('createdAt').last();
}

export async function wipeAll(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
}

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

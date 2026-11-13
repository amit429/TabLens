/** Chrome tab group colours as a plain string union (@types/chrome models them as an enum). */
export type GroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

export type TabState =
  | 'active'
  | 'simmering'
  | 'stale'
  | 'abandoned'
  | 'unfinished'
  | 'duplicate'
  | 'protected'
  | 'no-history';

export type PageType =
  | 'article'
  | 'product'
  | 'docs'
  | 'repo'
  | 'issue'
  | 'video'
  | 'search'
  | 'form'
  | 'app'
  | 'social'
  | 'mail'
  | 'other';

export type MissionKind = 'work' | 'personal';

/** Behaviour record for one tab, collected from install onward. */
export interface TabRecord {
  tabId: number;
  url: string;
  normUrl: string;
  title: string;
  favIconUrl?: string;
  windowId: number;
  /** When TabLens first saw the tab. For pre-install tabs this is the install time. */
  openedAt: number;
  /** Chrome's own lastAccessed, refreshed on every activation. */
  lastAccessed: number;
  activations: number;
  activeMs: number;
  /** 0–100 */
  maxScroll: number;
  interactions: number;
  formStarted: boolean;
  openerTabId?: number;
  openerUrl?: string;
  /** Up to the last 20 visit timestamps, newest last. */
  visits: number[];
  keep: boolean;
  /** False for tabs that were already open when TabLens was installed and haven't been visited since. */
  hasHistory: boolean;
}

export interface Snapshot {
  normUrl: string;
  url: string;
  title: string;
  pageType: PageType;
  description: string;
  headings: string[];
  /** Main text, capped at ~2,000 words. */
  text: string;
  keywords: string[];
  siteName?: string;
  capturedAt: number;
  /** AI summary (Gemini Nano or Gemini API), generated on demand for the dossier. */
  aiSummary?: string;
  aiTopics?: string[];
}

/** A tab as the analysis engine sees it: live Chrome data merged with the behaviour record and snapshot. */
export interface TabView {
  id: number;
  windowId: number;
  index: number;
  url: string;
  normUrl: string;
  title: string;
  favIconUrl?: string;
  domain: string;
  pinned: boolean;
  audible: boolean;
  discarded: boolean;
  groupId: number;
  incognito: boolean;
  lastAccessed: number;
  record?: TabRecord;
  snapshot?: Snapshot;
}

export interface Reason {
  /** Short machine key, used for icons and tests. */
  code: string;
  text: string;
}

export type Verdict = 'keep' | 'archive' | 'close-duplicate' | 'finish' | 'none';

export interface TabVerdict {
  tabId: number;
  state: TabState;
  /** Secondary states, e.g. a tab can be stale and a duplicate. */
  flags: TabState[];
  engagement: number;
  verdict: Verdict;
  reasons: Reason[];
  missionId: string;
  /** Why the tab belongs to its mission. */
  evidence: Reason[];
  pageType: PageType;
  duplicateOf?: number;
}

export interface Mission {
  id: string;
  name: string;
  intent: string;
  kind: MissionKind;
  color: GroupColor;
  tabIds: number[];
  confidence: number;
  source: 'model' | 'heuristic' | 'user' | 'rule';
  keywords: string[];
  insight?: string;
  /** Chrome tab group this mission is mirrored to, if any. */
  groupId?: number;
}

export interface PlanItem {
  id: string;
  kind: 'close-duplicates' | 'archive-abandoned' | 'archive-stale' | 'group-missions';
  label: string;
  tabIds: number[];
  missionIds?: string[];
  /** Pre-checked in the popup. */
  recommended: boolean;
}

export interface Analysis {
  id: string;
  createdAt: number;
  durationMs: number;
  engine: 'heuristic' | 'nano' | 'cloud';
  missions: Mission[];
  verdicts: Record<number, TabVerdict>;
  plan: PlanItem[];
  counts: Record<TabState, number> & { total: number; canGo: number };
}

export interface Rule {
  id: string;
  kind: 'domain' | 'url-prefix' | 'url';
  pattern: string;
  missionName: string;
  createdFrom: string;
  createdAt: number;
}

export interface ArchiveEntry {
  id: string;
  url: string;
  title: string;
  favIconUrl?: string;
  missionName?: string;
  archivedAt: number;
  lastState?: TabState;
  reason?: string;
  /** Set for snoozed tabs: when to reopen. */
  snoozeUntil?: number;
  /** Tabs archived by the same click share a batch id. */
  batchId: string;
}

export type SaveIntent = 'read' | 'buy' | 'reference' | 'watch' | 'todo' | 'inspiration';

export interface Save {
  id: string;
  url: string;
  title: string;
  favIconUrl?: string;
  intent: SaveIntent;
  note: string;
  remindAt?: number;
  bookmarkId?: string;
  createdAt: number;
  lastSeenAt?: number;
}

export interface BookmarkMeta {
  bookmarkId: string;
  intent?: SaveIntent;
  note?: string;
  lastSeenAt?: number;
}

import type { GroupColor } from './types';
import type { Analysis, ArchiveEntry, PageType, SaveIntent, Snapshot } from './types';
import type { NanoStatus } from './ai/router';
import type { QuotaInfo } from './ai/contract';

/** Every request a UI surface or content script can send to the background worker. */
export interface RpcMap {
  analyze: { req: { fresh?: boolean }; res: Analysis };
  applyPlan: { req: { closeIds: number[]; archiveIds: number[]; groupMissionIds: string[] }; res: UndoResult };
  archiveTabs: { req: { tabIds: number[]; reason?: string }; res: UndoResult };
  closeTabs: { req: { tabIds: number[] }; res: UndoResult };
  groupMissions: { req: { missionIds: string[] }; res: UndoResult };
  moveTabToMission: { req: { tabId: number; missionId: string; beforeTabId?: number; remember?: 'url' | 'domain' }; res: UndoResult };
  createMission: { req: { name: string; tabIds: number[] }; res: { missionId: string } };
  renameMission: { req: { missionId: string; name: string }; res: void };
  recolorMission: { req: { missionId: string; color: GroupColor }; res: void };
  mergeMissions: { req: { fromId: string; intoId: string }; res: UndoResult };
  archiveMission: { req: { missionId: string; onlyStale?: boolean }; res: UndoResult };
  focusMission: { req: { missionId: string | null }; res: { focused: string | null } };
  setKeep: { req: { tabIds: number[]; keep: boolean }; res: void };
  snoozeTabs: { req: { tabIds: number[]; until: number }; res: UndoResult };
  openTab: { req: { tabId: number }; res: void };
  openUrl: { req: { url: string; newWindow?: boolean }; res: void };
  restoreArchive: { req: { ids: string[]; newWindow?: boolean }; res: { opened: number } };
  deleteArchive: { req: { ids: string[] }; res: void };
  undo: { req: { undoId: string }; res: { ok: boolean } };
  saveForLater: { req: { url: string; title: string; favIconUrl?: string; intent: SaveIntent; note: string; remindAt?: number; closeTabId?: number }; res: { saveId: string } };
  deleteRule: { req: { ruleId: string }; res: void };
  enableContentReading: { req: Record<string, never>; res: { granted: boolean } };
  aiStatus: { req: Record<string, never>; res: { nano: NanoStatus } };
  cloudStatus: { req: Record<string, never>; res: { ok: boolean; message: string; model?: string; quota?: QuotaInfo } };
  summarizeTab: { req: { tabId: number }; res: { summary: string; topics: string[] } | null };
  deleteAllData: { req: Record<string, never>; res: { ok: boolean } };
  exportData: { req: Record<string, never>; res: { json: string } };
  importData: { req: { json: string }; res: { ok: boolean; message: string } };
  // From content scripts.
  shouldCapture: { req: { url: string }; res: { capture: boolean } };
  snapshot: { req: { snapshot: Omit<Snapshot, 'normUrl' | 'capturedAt' | 'keywords' | 'pageType'> & { pageType: PageType | null } }; res: void };
  metrics: { req: { maxScroll?: number; interactions?: number; formStarted?: boolean; heartbeat?: boolean }; res: void };
  switchToDuplicate: { req: { targetTabId: number; closeSelf: boolean }; res: void };
}

export interface UndoResult {
  undoId?: string;
  count: number;
  message: string;
}

export type RpcName = keyof RpcMap;
export interface RpcMessage<K extends RpcName = RpcName> {
  __tablens: true;
  type: K;
  payload: RpcMap[K]['req'];
}
type RpcReply<K extends RpcName> = { ok: true; data: RpcMap[K]['res'] } | { ok: false; error: string };

export async function rpc<K extends RpcName>(type: K, payload: RpcMap[K]['req']): Promise<RpcMap[K]['res']> {
  const reply = (await chrome.runtime.sendMessage({ __tablens: true, type, payload } satisfies RpcMessage<K>)) as RpcReply<K> | undefined;
  if (!reply) throw new Error(`No response from TabLens background for ${type}`);
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

export type RpcHandlers = { [K in RpcName]: (payload: RpcMap[K]['req'], sender: chrome.runtime.MessageSender) => Promise<RpcMap[K]['res']> };

export function serveRpc(handlers: RpcHandlers) {
  chrome.runtime.onMessage.addListener((msg: RpcMessage, sender, sendResponse) => {
    if (!msg || msg.__tablens !== true) return false;
    const handler = handlers[msg.type] as (p: unknown, s: chrome.runtime.MessageSender) => Promise<unknown>;
    if (!handler) {
      sendResponse({ ok: false, error: `Unknown request ${msg.type}` });
      return false;
    }
    handler(msg.payload, sender).then(
      (data) => sendResponse({ ok: true, data }),
      (err: unknown) => {
        console.error('[TabLens]', msg.type, err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      },
    );
    return true;
  });
}

export type { ArchiveEntry };

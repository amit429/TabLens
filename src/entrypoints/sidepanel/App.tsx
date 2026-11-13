import * as React from 'react';
import { BookmarkPlus, Crosshair, FolderTree, LayoutDashboard, ScanEye, SquareKanban } from 'lucide-react';
import { Wordmark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { DossierView } from '@/components/dossier';
import { SaveForm } from '@/components/save-dialog';
import { Spectrum } from '@/components/spectrum';
import { GROUP_COLOR_VAR } from '@/components/tab-bits';
import { useAnalysis, useChromeGroups, useChromeTabs, useLiveMissions } from '@/hooks/data';
import { isMissionGrouped } from '@/lib/analysis/analyze';
import { rpc } from '@/lib/rpc';
import { act } from '@/lib/ui-actions';

type View = 'tab' | 'missions' | 'save';

/** Follows the active tab in this window. */
function useActiveTab() {
  const [tab, setTab] = React.useState<chrome.tabs.Tab | null>(null);
  React.useEffect(() => {
    let windowId: number | undefined;
    const read = () => chrome.tabs.query({ active: true, ...(windowId ? { windowId } : { currentWindow: true }) }).then(([t]) => setTab(t ?? null));
    chrome.windows.getCurrent().then((w) => {
      windowId = w.id;
      read();
    });
    const onActivated = (info: chrome.tabs.OnActivatedInfo) => info.windowId === windowId && read();
    const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo, t: chrome.tabs.Tab) => t.active && t.windowId === windowId && (change.title || change.url) && setTab(t);
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  return tab;
}

export default function App() {
  const analysis = useAnalysis();
  const tabs = useChromeTabs();
  const live = useLiveMissions(analysis, tabs);
  const active = useActiveTab();
  const groups = useChromeGroups();
  const [view, setView] = React.useState<View>('tab');

  // The context menu "Save page to TabLens…" opens the panel on the Save view.
  React.useEffect(() => {
    chrome.storage.session.get('sidePanelView').then((s) => {
      if (s.sidePanelView) {
        setView(s.sidePanelView as View);
        chrome.storage.session.remove('sidePanelView');
      }
    });
    const on = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && c.sidePanelView?.newValue) {
        setView(c.sidePanelView.newValue as View);
        chrome.storage.session.remove('sidePanelView');
      }
    };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, []);

  const isWeb = /^https?:/.test(active?.url ?? '');
  const missions = live.missions.filter((m) => m.live.length);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center gap-2 px-4 pb-2 pt-3">
        <Wordmark />
        <Tooltip content="Open dashboard" side="bottom">
          <Button variant="ghost" size="icon" className="ml-auto" aria-label="Open dashboard" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('/dashboard.html') })}>
            <LayoutDashboard />
          </Button>
        </Tooltip>
      </header>
      <Tabs value={view} onValueChange={(v) => setView(v as View)} className="flex min-h-0 flex-1 flex-col">
        <div className="px-4">
          <TabsList className="w-full">
            <TabsTrigger value="tab">
              <ScanEye /> This tab
            </TabsTrigger>
            <TabsTrigger value="missions">
              <SquareKanban /> Missions
            </TabsTrigger>
            <TabsTrigger value="save">
              <BookmarkPlus /> Save
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="tab" className="mt-3 flex min-h-0 flex-1 flex-col border-t border-border data-[state=inactive]:hidden">
          {active?.id !== undefined && isWeb ? (
            <DossierView key={active.id} tabId={active.id} analysis={analysis} />
          ) : (
            <p className="p-6 text-[13px] text-muted-foreground">Switch to a web page to see what it is, what you did on it and why it's in its mission.</p>
          )}
        </TabsContent>

        <TabsContent value="missions" className="mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin data-[state=inactive]:hidden">
          <ul className="space-y-2">
            {missions.map((m) => {
              const items = m.live.map((l) => ({ id: l.tab.id!, title: l.tab.title ?? '', url: l.tab.url, state: l.verdict?.state ?? 'active' }));
              const grouped = isMissionGrouped(m, m.live.map((l) => ({ groupId: l.tab.groupId ?? -1, pinned: l.tab.pinned })), groups);
              const hasActive = m.live.some((l) => l.tab.id === active?.id);
              return (
                <li key={m.id} className={`rounded-[12px] border bg-card p-3 ${hasActive ? 'border-foreground/40' : 'border-border'}`}>
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: GROUP_COLOR_VAR[m.color] }} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{m.name}</span>
                    <span className="tabular text-[12px] text-muted-foreground">{m.live.length}</span>
                  </div>
                  <Spectrum items={items} height={8} className="mt-2 rounded-full" onSelect={(id) => rpc('openTab', { tabId: id })} />
                  {(m.insight || m.intent) && <p className="mt-2 line-clamp-2 text-[12px] text-muted-foreground">{m.insight ?? m.intent}</p>}
                  {m.id !== 'unsorted' && (
                    <div className="mt-2 flex gap-1.5">
                      {!grouped && m.live.length > 1 && (
                        <Button size="sm" variant="soft" onClick={() => act(rpc('groupMissions', { missionIds: [m.id] }))}>
                          <FolderTree /> Group
                        </Button>
                      )}
                      <Button size="sm" variant="soft" onClick={() => act(rpc('focusMission', { missionId: m.id }).then((r) => ({ count: 0, message: r.focused ? `Focusing on ${m.name}` : 'Focus off' })))}>
                        <Crosshair /> Focus
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </TabsContent>

        <TabsContent value="save" className="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-border px-4 py-4 scrollbar-thin data-[state=inactive]:hidden">
          {active && isWeb ? (
            <SaveForm key={active.id} compact page={{ url: active.url!, title: active.title ?? active.url!, favIconUrl: active.favIconUrl, tabId: active.id }} onDone={() => setView('tab')} />
          ) : (
            <p className="text-[13px] text-muted-foreground">Switch to a web page to save it.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

import * as React from 'react';
import { Archive, BookMarked, Command as CommandIcon, Crosshair, Gauge, Hand, Loader2, RefreshCw, Settings2, SquareKanban } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Wordmark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/input';
import { Dossier } from '@/components/dossier';
import { QuickFindDialog, useQuickFindHotkey } from '@/components/quick-find';
import { useAnalysis, useChromeTabs, useLiveMissions, useNow } from '@/hooks/data';
import { db } from '@/lib/db';
import { rpc } from '@/lib/rpc';
import { formatAgo } from '@/lib/analysis/states';
import { cn } from '@/lib/cn';
import type { Analysis } from '@/lib/types';
import Overview from './pages/Overview';
import Board from './pages/Board';
import Unfinished from './pages/Unfinished';
import Library from './pages/Library';
import ArchivePage from './pages/Archive';
import Settings from './pages/Settings';
import Welcome from './pages/Welcome';

type Route = 'overview' | 'missions' | 'unfinished' | 'library' | 'archive' | 'settings' | 'welcome';

interface Ctx {
  analysis: Analysis | null | undefined;
  tabs: chrome.tabs.Tab[];
  live: ReturnType<typeof useLiveMissions>;
  openDossier: (tabId: number) => void;
  navigate: (r: Route) => void;
  reanalyse: () => Promise<void>;
  analysing: boolean;
}

export const DashboardContext = React.createContext<Ctx>(null!);
export const useDashboard = () => React.useContext(DashboardContext);

function useRoute(): [Route, (r: Route) => void] {
  const read = () => (window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'overview') as Route;
  const [route, setRoute] = React.useState<Route>(read);
  React.useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (r) => (window.location.hash = `/${r}`)];
}

const NAV: { id: Route; label: string; icon: typeof Gauge }[] = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'missions', label: 'Missions', icon: SquareKanban },
  { id: 'unfinished', label: 'Unfinished', icon: Hand },
  { id: 'library', label: 'Library', icon: BookMarked },
  { id: 'archive', label: 'Archive', icon: Archive },
];

export default function App() {
  const [route, navigate] = useRoute();
  const analysis = useAnalysis();
  const allTabs = useChromeTabs();
  const tabs = React.useMemo(() => allTabs.filter((t) => !(t.url ?? '').startsWith(`chrome-extension://${chrome.runtime.id}`)), [allTabs]);
  const live = useLiveMissions(analysis, tabs);
  const [dossier, setDossier] = React.useState<number | null>(null);
  const [findOpen, setFindOpen] = React.useState(false);
  const [analysing, setAnalysing] = React.useState(false);
  const now = useNow();
  useQuickFindHotkey(setFindOpen);
  const archiveCount = useLiveQuery(() => db.archive.count(), []) ?? 0;
  const focused = useFocused();

  React.useEffect(() => {
    if (analysis === null) rpc('analyze', {}).catch(() => {});
  }, [analysis]);

  const reanalyse = async () => {
    setAnalysing(true);
    try {
      await rpc('analyze', { fresh: true });
    } finally {
      setAnalysing(false);
    }
  };

  const unfinished = tabs.filter((t) => analysis?.verdicts[t.id!]?.state === 'unfinished').length;
  const missionCount = live.missions.filter((m) => m.id !== 'unsorted' && m.live.length).length;
  const counts: Partial<Record<Route, number>> = { missions: missionCount, unfinished, archive: archiveCount };

  const ctx: Ctx = { analysis, tabs, live, openDossier: setDossier, navigate, reanalyse, analysing };

  if (route === 'welcome')
    return (
      <DashboardContext.Provider value={ctx}>
        <Welcome />
      </DashboardContext.Provider>
    );

  return (
    <DashboardContext.Provider value={ctx}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-[228px] shrink-0 flex-col border-r border-border bg-card/60 px-3 py-4 md:flex">
          <div className="px-2 pb-5">
            <Wordmark />
          </div>
          <nav className="space-y-0.5" aria-label="Sections">
            {NAV.map((n) => (
              <NavItem key={n.id} active={route === n.id} onClick={() => navigate(n.id)} icon={n.icon} label={n.label} count={counts[n.id]} />
            ))}
          </nav>
          <div className="mt-auto space-y-3">
            {focused && (
              <div className="rounded-[10px] border border-border bg-muted/60 p-2.5 text-[12px]">
                <div className="flex items-center gap-1.5 font-medium">
                  <Crosshair className="size-3.5" /> Focus mode
                </div>
                <div className="mt-0.5 truncate text-muted-foreground">{analysis?.missions.find((m) => m.id === focused)?.name ?? 'A mission'}</div>
                <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => rpc('focusMission', { missionId: null })}>
                  Leave focus
                </Button>
              </div>
            )}
            <NavItem active={route === 'settings'} onClick={() => navigate('settings')} icon={Settings2} label="Settings" />
            <div className="px-2 text-[11px] leading-snug text-muted-foreground">
              {analysis ? (
                <>
                  Analysed {formatAgo(now - analysis.createdAt)}
                  <br />
                  {analysis.engine === 'heuristic' ? 'Names from on-device heuristics' : analysis.engine === 'nano' ? 'Names by Gemini Nano, on device' : 'Names by Gemini'}
                </>
              ) : (
                'Not analysed yet'
              )}
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur md:px-8">
            <div className="md:hidden">
              <Wordmark />
            </div>
            <h1 className="hidden font-display text-[18px] font-semibold md:block">{route === 'settings' ? 'Settings' : NAV.find((n) => n.id === route)?.label}</h1>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" onClick={() => setFindOpen(true)} className="w-40 justify-start text-muted-foreground sm:w-56">
                <CommandIcon /> Find a tab…
                <Kbd className="ml-auto">⌘K</Kbd>
              </Button>
              <Button onClick={reanalyse} disabled={analysing}>
                {analysing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                <span className="hidden sm:inline">Re-analyse</span>
              </Button>
            </div>
          </header>
          <nav className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2 md:hidden" aria-label="Sections">
            {[...NAV, { id: 'settings' as Route, label: 'Settings', icon: Settings2 }].map((n) => (
              <Button key={n.id} size="sm" variant={route === n.id ? 'default' : 'ghost'} onClick={() => navigate(n.id)}>
                {n.label}
              </Button>
            ))}
          </nav>
          <main className="px-4 py-6 md:px-8">
            {route === 'overview' && <Overview />}
            {route === 'missions' && <Board />}
            {route === 'unfinished' && <Unfinished />}
            {route === 'library' && <Library />}
            {route === 'archive' && <ArchivePage />}
            {route === 'settings' && <Settings />}
          </main>
        </div>
      </div>
      <Dossier tabId={dossier} analysis={analysis} onOpenChange={(o) => !o && setDossier(null)} />
      <QuickFindDialog open={findOpen} onOpenChange={setFindOpen} analysis={analysis} />
    </DashboardContext.Provider>
  );
}

function NavItem({ active, onClick, icon: Icon, label, count }: { active: boolean; onClick: () => void; icon: typeof Gauge; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2 text-[13px] font-medium transition-colors',
        active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
      {label}
      {!!count && <span className={cn('tabular ml-auto text-[12px]', active ? 'text-background/70' : 'text-muted-foreground')}>{count}</span>}
    </button>
  );
}

function useFocused() {
  const [id, setId] = React.useState<string | null>(null);
  React.useEffect(() => {
    const read = () => chrome.storage.session.get('focusState').then((s) => setId((s.focusState as { missionId?: string } | undefined)?.missionId ?? null));
    read();
    const on = (_c: unknown, area: string) => area === 'session' && read();
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, []);
  return id;
}

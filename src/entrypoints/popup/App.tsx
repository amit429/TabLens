import * as React from 'react';
import { ArrowLeft, Eye, LayoutDashboard, Loader2, PanelRight, RefreshCw, Search, Settings2, ShieldCheck } from 'lucide-react';
import { Wordmark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { Spectrum, SpectrumLegend, type SpectrumItem } from '@/components/spectrum';
import { CleanupPlan } from '@/components/cleanup-plan';
import { QuickFindList } from '@/components/quick-find';
import { Favicon, ReadDepth, reasonLine } from '@/components/tab-bits';
import { useAnalysis, useChromeTabs, useNow } from '@/hooks/data';
import { rpc } from '@/lib/rpc';
import { act } from '@/lib/ui-actions';
import { formatAgo } from '@/lib/analysis/states';
import type { TabState } from '@/lib/types';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { requestAccess, usePageAccess } from '@/hooks/access';

export default function App() {
  const analysis = useAnalysis();
  const tabs = useChromeTabs();
  const now = useNow(15_000);
  const [view, setView] = React.useState<'lens' | 'find'>('lens');
  const [running, setRunning] = React.useState(false);
  const [highlight, setHighlight] = React.useState<TabState | null>(null);
  const hasAccess = usePageAccess();

  // Refresh quietly when the popup opens on an old analysis.
  React.useEffect(() => {
    if (analysis === null || (analysis && Date.now() - analysis.createdAt > 60_000)) rpc('analyze', {}).catch(() => {});
  }, [analysis === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const ext = `chrome-extension://${chrome.runtime.id}`;
  const liveTabs = tabs.filter((t) => !(t.url ?? '').startsWith(ext));
  const items: SpectrumItem[] = liveTabs.map((t) => ({ id: t.id!, title: t.title ?? '', url: t.url, state: analysis?.verdicts[t.id!]?.state ?? 'active' }));
  const unfinished = liveTabs.filter((t) => analysis?.verdicts[t.id!]?.state === 'unfinished');
  const missions = analysis ? analysis.missions.filter((m) => m.id !== 'unsorted' && m.tabIds.some((id) => liveTabs.some((t) => t.id === id))).length : 0;
  const canGo = items.filter((i) => i.state === 'abandoned' || i.state === 'duplicate' || i.state === 'stale').length;

  const reanalyse = async () => {
    setRunning(true);
    try {
      await rpc('analyze', { fresh: true });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex max-h-[600px] min-h-[420px] w-[400px] flex-col bg-background">
      <header className="flex items-center gap-1 px-4 pb-2 pt-3">
        {view === 'find' ? (
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setView('lens')}>
            <ArrowLeft /> Back
          </Button>
        ) : (
          <Wordmark />
        )}
        <div className="ml-auto flex items-center">
          <IconButton label="Find a tab (⌘K)" onClick={() => setView(view === 'find' ? 'lens' : 'find')}>
            <Search />
          </IconButton>
          <IconButton
            label="Open side panel"
            onClick={async () => {
              const w = await chrome.windows.getCurrent();
              await chrome.sidePanel.open({ windowId: w.id! });
              window.close();
            }}
          >
            <PanelRight />
          </IconButton>
          <IconButton label="Open dashboard" onClick={() => openPage('')}>
            <LayoutDashboard />
          </IconButton>
          <IconButton label="Settings" onClick={() => openPage('#/settings')}>
            <Settings2 />
          </IconButton>
        </div>
      </header>

      {view === 'find' ? (
        <QuickFindList analysis={analysis} onDone={() => window.close()} className="flex-1" />
      ) : (
        <main className="flex-1 overflow-y-auto px-4 scrollbar-thin">
          <section className="pt-1">
            <Spectrum items={items} height={34} highlight={highlight} onSelect={(id) => rpc('openTab', { tabId: id })} animateKey={analysis?.id} />
            <SpectrumLegend items={items} active={highlight} onToggle={setHighlight} className="mt-2" />
            <h1 className="mt-4 font-display text-[22px] font-semibold leading-[1.15] tracking-[-0.015em]">
              {analysis === undefined ? (
                'Reading your tabs…'
              ) : (
                <>
                  {liveTabs.length} tabs in {missions} mission{missions === 1 ? '' : 's'}.
                  <span className="block text-muted-foreground">
                    {canGo ? `${canGo} can go.` : 'Nothing is going stale.'}
                    {unfinished.length ? ` ${unfinished.length} ${unfinished.length === 1 ? 'has' : 'have'} unfinished work.` : ''}
                  </span>
                </>
              )}
            </h1>
          </section>

          {hasAccess === false && (
            <div className="mt-4 rounded-[12px] border border-accent/30 bg-accent-soft p-3">
              <div className="flex items-start gap-2.5">
                <Eye className="mt-0.5 size-4 shrink-0 text-accent" />
                <div className="text-[13px]">
                  <div className="font-medium">Grouping uses titles only</div>
                  <p className="mt-0.5 text-muted-foreground">Let TabLens read pages for sharper missions and read-depth. Banking, payment and health sites stay excluded.</p>
                  <Button size="sm" variant="accent" className="mt-2" onClick={requestAccess}>
                    Allow page reading
                  </Button>
                </div>
              </div>
            </div>
          )}

          <section className="mt-5">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="font-display text-[15px] font-semibold">Cleanup plan</h2>
              {analysis && (
                <span className="text-[12px] text-muted-foreground">
                  Analysed {formatAgo(now - analysis.createdAt)}
                  {analysis.engine !== 'heuristic' && ` with ${analysis.engine === 'nano' ? 'Gemini Nano' : 'Gemini'}`}
                </span>
              )}
              <Tooltip content="Re-analyse with AI naming">
                <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={reanalyse} disabled={running} aria-label="Re-analyse">
                  {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                </Button>
              </Tooltip>
            </div>
            {analysis ? <CleanupPlan analysis={analysis} tabs={liveTabs} stickyFooter /> : <PlanSkeleton />}
          </section>

          {!!unfinished.length && analysis && (
            <section className="mb-4 mt-5">
              <h2 className="mb-2 flex items-center gap-1.5 font-display text-[15px] font-semibold">
                <ShieldCheck className="size-4 text-unfinished" /> Unfinished — kept for you
              </h2>
              <ul className="space-y-1">
                {unfinished.map((t) => {
                  const v = analysis.verdicts[t.id!]!;
                  return (
                    <li key={t.id} className="group flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 hover:bg-muted">
                      <Favicon url={t.url} favIconUrl={t.favIconUrl} />
                      <button className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => rpc('openTab', { tabId: t.id! })}>
                        <span className="block truncate text-[13px]">{t.title}</span>
                        <span className="block truncate text-[12px] text-muted-foreground">{reasonLine(v.reasons.slice(0, 1))}</span>
                      </button>
                      <UnfinishedDepth tabId={t.id!} />
                      <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => act(rpc('setKeep', { tabIds: [t.id!], keep: true }), { success: 'Kept' })}>
                        Keep
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <div className="h-3" />
        </main>
      )}
    </div>
  );
}

function UnfinishedDepth({ tabId }: { tabId: number }) {
  const r = useLiveQuery(() => db.tabs.get(tabId), [tabId]);
  if (!r || r.formStarted || !r.maxScroll) return null;
  return <ReadDepth value={r.maxScroll} />;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip content={label} side="bottom">
      <Button variant="ghost" size="icon" aria-label={label} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

function PlanSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-[10px] bg-muted" />
      ))}
    </div>
  );
}

async function openPage(hash: string) {
  const url = chrome.runtime.getURL('/dashboard.html');
  const [existing] = await chrome.tabs.query({ url: url + '*' });
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, url: url + hash });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.tabs.create({ url: url + hash });
  window.close();
}

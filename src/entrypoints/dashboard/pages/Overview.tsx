import * as React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, BookMarked, Eye, RefreshCcw } from 'lucide-react';
import { useDashboard } from '../App';
import { Spectrum, SpectrumLegend, type SpectrumItem } from '@/components/spectrum';
import { CleanupPlan } from '@/components/cleanup-plan';
import { Button } from '@/components/ui/button';
import { Favicon, GROUP_COLOR_VAR, ReadDepth, hostOf, reasonLine } from '@/components/tab-bits';
import { requestAccess, usePageAccess } from '@/hooks/access';
import { db } from '@/lib/db';
import { rpc } from '@/lib/rpc';
import { act } from '@/lib/ui-actions';
import { formatAgo } from '@/lib/analysis/states';
import { INTENTS } from '@/lib/library';
import type { TabState } from '@/lib/types';

export default function Overview() {
  const { analysis, tabs, live, openDossier, navigate } = useDashboard();
  const [highlight, setHighlight] = React.useState<TabState | null>(null);
  const access = usePageAccess();
  const items: SpectrumItem[] = tabs.map((t) => ({ id: t.id!, title: t.title ?? '', url: t.url, state: analysis?.verdicts[t.id!]?.state ?? 'active' }));
  const count = (s: TabState) => items.filter((i) => i.state === s).length;
  const unfinished = tabs.filter((t) => analysis?.verdicts[t.id!]?.state === 'unfinished');
  const missions = live.missions.filter((m) => m.id !== 'unsorted' && m.live.length);
  const windows = [...new Set(tabs.map((t) => t.windowId))];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section aria-labelledby="spectrum-h">
        <h2 id="spectrum-h" className="sr-only">Every open tab by state</h2>
        <Spectrum items={items} height={52} highlight={highlight} onSelect={openDossier} animateKey={analysis?.id} className="rounded-[10px]" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <SpectrumLegend items={items} active={highlight} onToggle={setHighlight} />
          <span className="text-[12px] text-muted-foreground">Click a slice to see why that tab is where it is.</span>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-y-4 border-y border-border py-4 sm:grid-cols-5 sm:divide-x sm:divide-border">
          <Stat label="Open tabs" value={tabs.length} />
          <Stat label="Missions" value={missions.length} />
          <Stat label="Can go" value={count('abandoned') + count('stale') + count('duplicate')} tone="var(--state-stale)" />
          <Stat label="Duplicates" value={count('duplicate')} tone="var(--state-duplicate)" />
          <Stat label="Unfinished" value={unfinished.length} tone="var(--state-unfinished)" />
        </dl>
      </section>

      {access === false && (
        <section className="flex flex-wrap items-center gap-4 rounded-[14px] border border-accent/30 bg-accent-soft px-5 py-4">
          <Eye className="size-5 text-accent" />
          <div className="min-w-60 flex-1">
            <div className="font-medium">Missions are grouped by title and URL only</div>
            <p className="text-[13px] text-muted-foreground">Allow page reading so TabLens can see what each page is about and how far you read it. Excluded sites are never read.</p>
          </div>
          <Button variant="accent" onClick={requestAccess}>
            Allow page reading
          </Button>
        </section>
      )}

      {!!unfinished.length && analysis && (
        <section>
          <SectionHead title="Unfinished work" hint="Never suggested for cleanup until you finish or save it" action={<Button variant="ghost" size="sm" onClick={() => navigate('unfinished')}>See all <ArrowRight /></Button>} />
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unfinished.slice(0, 6).map((t) => (
              <li key={t.id}>
                <button onClick={() => openDossier(t.id!)} className="flex w-full cursor-pointer items-start gap-3 rounded-[12px] border border-border bg-card p-3 text-left transition-colors hover:border-unfinished/50">
                  <Favicon url={t.url} favIconUrl={t.favIconUrl} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-[13px] font-medium">{t.title}</span>
                    <span className="mt-0.5 line-clamp-1 text-[12px] text-unfinished">{reasonLine(analysis.verdicts[t.id!]!.reasons.slice(0, 1))}</span>
                  </span>
                  <UnfinishedDepth tabId={t.id!} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section>
          <SectionHead title="Cleanup plan" hint="Pick what to apply. Every action can be undone, and archived tabs stay restorable." />
          {analysis ? <CleanupPlan analysis={analysis} tabs={tabs} /> : <div className="h-40 animate-pulse rounded-[12px] bg-muted" />}
        </section>

        <div className="space-y-8">
          <section>
            <SectionHead title="Missions" action={<Button variant="ghost" size="sm" onClick={() => navigate('missions')}>Open board <ArrowRight /></Button>} />
            <ul className="divide-y divide-border rounded-[12px] border border-border bg-card">
              {missions.slice(0, 8).map((m) => (
                <li key={m.id}>
                  <button onClick={() => navigate('missions')} className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: GROUP_COLOR_VAR[m.color] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{m.name}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{m.insight ?? m.intent}</span>
                    </span>
                    <Spectrum items={m.live.map((l) => ({ id: l.tab.id!, title: l.tab.title ?? '', url: l.tab.url, state: l.verdict?.state ?? 'active' }))} height={14} className="w-20 shrink-0" />
                  </button>
                </li>
              ))}
              {!missions.length && <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">Missions appear after the first analysis.</li>}
            </ul>
          </section>

          {windows.length > 1 && (
            <section>
              <SectionHead title="Windows" />
              <ul className="space-y-2">
                {windows.map((w, i) => {
                  const wt = items.filter((it) => tabs.find((t) => t.id === it.id)?.windowId === w);
                  return (
                    <li key={w} className="flex items-center gap-3 text-[13px]">
                      <span className="w-20 shrink-0 text-muted-foreground">Window {i + 1}</span>
                      <Spectrum items={wt} height={12} className="flex-1" onSelect={openDossier} />
                      <span className="tabular w-8 text-right text-muted-foreground">{wt.length}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <Resurface />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="px-0 sm:px-5 sm:first:pl-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="tabular font-display text-[30px] font-semibold leading-tight tracking-[-0.02em]" style={{ color: value && tone ? `color-mix(in oklab, ${tone} 85%, var(--foreground))` : undefined }}>
        {value}
      </dd>
    </div>
  );
}

export function SectionHead({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

function UnfinishedDepth({ tabId }: { tabId: number }) {
  const r = useLiveQuery(() => db.tabs.get(tabId), [tabId]);
  if (!r || r.formStarted || !r.maxScroll) return null;
  return <ReadDepth value={r.maxScroll} />;
}

/** One forgotten save a day: oldest-seen first, rotated daily. */
function Resurface() {
  const saves = useLiveQuery(() => db.saves.toArray(), []) ?? [];
  const [offset, setOffset] = React.useState(0);
  if (!saves.length) return null;
  const sorted = [...saves].sort((a, b) => (a.lastSeenAt ?? a.createdAt) - (b.lastSeenAt ?? b.createdAt));
  const day = Math.floor(Date.now() / 86_400_000);
  const s = sorted[(day + offset) % sorted.length]!;
  const intent = INTENTS.find((i) => i.id === s.intent);
  return (
    <section>
      <SectionHead
        title="From your library"
        action={
          <Button variant="ghost" size="icon-sm" aria-label="Show another" onClick={() => setOffset((o) => o + 1)}>
            <RefreshCcw />
          </Button>
        }
      />
      <div className="rounded-[12px] border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Favicon url={s.url} favIconUrl={s.favIconUrl} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[14px] font-medium">{s.title}</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              {intent?.label} · saved {formatAgo(Date.now() - s.createdAt)} · {s.lastSeenAt && s.lastSeenAt > s.createdAt + 60_000 ? `last seen ${formatAgo(Date.now() - s.lastSeenAt)}` : 'not opened since'}
            </div>
            {s.note && <p className="mt-2 border-l-2 border-border pl-2.5 text-[13px] italic text-muted-foreground">{s.note}</p>}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => rpc('openUrl', { url: s.url })}>
            <BookMarked /> Open
          </Button>
          <Button size="sm" variant="ghost" onClick={() => act(db.saves.delete(s.id).then(() => ({ count: 1, message: `Removed ${hostOf(s.url)} from your library` })))}>
            Done with it
          </Button>
        </div>
      </div>
    </section>
  );
}

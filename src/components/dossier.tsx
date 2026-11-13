import * as React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, BookmarkPlus, ExternalLink, Loader2, MoveRight, ShieldCheck, ShieldOff, Sparkles, AlarmClock } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Favicon, GROUP_COLOR_VAR, PageTypeIcon, ReadDepth, ReasonList, StateChip, hostOf } from './tab-bits';
import { SnoozeMenu } from './snooze-menu';
import { SaveDialog } from './save-dialog';
import { db } from '@/lib/db';
import { rpc } from '@/lib/rpc';
import { act } from '@/lib/ui-actions';
import { normalizeUrl } from '@/lib/url';
import { PAGE_TYPE_LABEL } from '@/lib/analysis/pagetype';
import { formatAgo, formatDuration, DAY } from '@/lib/analysis/states';
import type { Analysis, TabRecord } from '@/lib/types';
import { UNSORTED_ID } from '@/lib/analysis/analyze';
import { truncateWords } from '@/lib/text';
import { cn } from '@/lib/cn';

const VERDICT_LABEL = {
  keep: 'Keep',
  archive: 'Suggest archiving',
  'close-duplicate': 'Suggest closing this copy',
  finish: 'Finish or save before closing',
  none: 'No suggestion yet',
} as const;

export function Dossier({ tabId, analysis, onOpenChange }: { tabId: number | null; analysis: Analysis | null | undefined; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={tabId !== null} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>{tabId !== null && <DossierView tabId={tabId} analysis={analysis} close={() => onOpenChange(false)} inSheet />}</SheetContent>
    </Sheet>
  );
}

/** The dossier content; used in the dashboard sheet and inline in the side panel. */
export function DossierView({ tabId, analysis, close, inSheet }: { tabId: number; analysis: Analysis | null | undefined; close?: () => void; inSheet?: boolean }) {
  const Title = inSheet ? SheetTitle : 'h2';
  const Desc = inSheet ? SheetDescription : 'div';
  const [tab, setTab] = React.useState<chrome.tabs.Tab | null>(null);
  React.useEffect(() => {
    chrome.tabs.get(tabId).then(setTab, () => setTab(null));
  }, [tabId]);
  const record = useLiveQuery(() => db.tabs.get(tabId), [tabId]);
  const snapshot = useLiveQuery(() => (tab?.url ? db.snapshots.get(normalizeUrl(tab.url)) : undefined), [tab?.url]);
  const opener = useLiveQuery(() => (record?.openerTabId !== undefined ? db.tabs.get(record.openerTabId) : undefined), [record?.openerTabId]);
  const [summarizing, setSummarizing] = React.useState(false);
  React.useEffect(() => {
    // The side panel follows the active tab; refresh title/url when it navigates.
    const on = (id: number) => id === tabId && chrome.tabs.get(tabId).then(setTab, () => setTab(null));
    chrome.tabs.onUpdated.addListener(on);
    return () => chrome.tabs.onUpdated.removeListener(on);
  }, [tabId]);
  const [saveOpen, setSaveOpen] = React.useState(false);

  if (!tab) return <div className="p-6 text-[13px] text-muted-foreground">This tab is no longer open.</div>;
  const v = analysis?.verdicts[tabId];
  const mission = analysis?.missions.find((m) => m.id === v?.missionId);
  const pageType = snapshot?.pageType && snapshot.pageType !== 'other' ? snapshot.pageType : (v?.pageType ?? 'other');
  const about = snapshot?.aiSummary ?? (snapshot?.description || (snapshot?.text ? truncateWords(snapshot.text, 45) : ''));
  const kept = !!record?.keep;

  return (
    <>
      <div className="border-b border-border px-5 pb-4 pt-5">
        <div className={cn('flex items-start gap-3', inSheet && 'pr-6')}>
          <Favicon url={tab.url} favIconUrl={tab.favIconUrl} size={20} className="mt-0.5" />
          <div className="min-w-0">
            <Title className="line-clamp-2 font-display text-[17px] font-semibold leading-tight">{tab.title}</Title>
            <Desc className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <span>{hostOf(tab.url)}</span>
              <span className="inline-flex items-center gap-1">
                <PageTypeIcon type={pageType} />
                {PAGE_TYPE_LABEL[pageType]}
              </span>
              {v && <StateChip state={v.state} />}
              {v?.flags.map((f) => <StateChip key={f} state={f} />)}
            </Desc>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 scrollbar-thin">
        <Section title="What it is">
          {about ? (
            <p className="text-[13px] leading-relaxed">{about}</p>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {snapshot === undefined ? 'TabLens hasn’t read this page yet.' : 'No readable text on this page.'} Allow page reading in Settings to see what each tab is about.
            </p>
          )}
          {snapshot && !snapshot.aiSummary && snapshot.text.length > 200 && (
            <Button
              variant="soft"
              size="sm"
              className="mt-2"
              disabled={summarizing}
              onClick={async () => {
                setSummarizing(true);
                try {
                  const r = await rpc('summarizeTab', { tabId });
                  if (!r) (await import('sonner')).toast('Turn on Gemini in Settings → AI to get summaries.');
                } catch (e) {
                  (await import('sonner')).toast.error(e instanceof Error ? e.message : String(e));
                } finally {
                  setSummarizing(false);
                }
              }}
            >
              {summarizing ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Summarize with Gemini
            </Button>
          )}
          {!!snapshot?.headings.length && (
            <div className="mt-3">
              <div className="mb-1 text-[12px] text-muted-foreground">Outline</div>
              <ol className="space-y-0.5 border-l border-border pl-3 text-[12px] text-muted-foreground">
                {snapshot.headings.slice(0, 7).map((h, i) => (
                  <li key={i} className="truncate">
                    {h}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {!!(snapshot?.aiTopics?.length || snapshot?.keywords.length) && (
            <div className="mt-3 flex flex-wrap gap-1">
              {(snapshot.aiTopics?.length ? snapshot.aiTopics : snapshot.keywords.slice(0, 6)).map((k) => (
                <Badge key={k}>{k}</Badge>
              ))}
            </div>
          )}
        </Section>

        <Section title="What you did">
          {record ? <Activity record={record} openerTitle={opener?.title ?? record.openerUrl} /> : <p className="text-[13px] text-muted-foreground">No activity recorded for this tab yet.</p>}
        </Section>

        <Section title="Why it's here">
          {mission && (
            <div className="mb-2 flex items-center gap-2 text-[13px]">
              <span className="size-2.5 rounded-full" style={{ background: GROUP_COLOR_VAR[mission.color] }} />
              <span className="text-muted-foreground">{mission.id === UNSORTED_ID ? 'Not in a mission:' : 'In mission'}</span>
              <span className="font-medium">{mission.id === UNSORTED_ID ? 'Unsorted' : mission.name}</span>
            </div>
          )}
          <ReasonList reasons={v?.evidence ?? [{ code: 'new', text: 'Opened after the last analysis' }]} />
          <div className="mt-4 rounded-[10px] border border-border bg-muted/50 p-3">
            <div className="mb-1.5 text-[13px] font-semibold">{v ? VERDICT_LABEL[v.verdict] : 'Not analysed yet'}</div>
            <ReasonList reasons={v?.reasons ?? []} className="text-muted-foreground" />
          </div>
        </Section>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-3">
        <Button size="sm" onClick={() => rpc('openTab', { tabId })}>
          <ExternalLink /> Open
        </Button>
        <Button size="sm" variant="outline" onClick={() => act(rpc('setKeep', { tabIds: [tabId], keep: !kept }), { success: kept ? 'Keep removed' : 'Kept — never suggested for cleanup' })}>
          {kept ? <ShieldOff /> : <ShieldCheck />} {kept ? 'Unkeep' : 'Keep'}
        </Button>
        <SnoozeMenu tabIds={[tabId]} onDone={() => close?.()}>
          <Button size="sm" variant="outline">
            <AlarmClock /> Snooze
          </Button>
        </SnoozeMenu>
        <Button size="sm" variant="outline" onClick={() => setSaveOpen(true)}>
          <BookmarkPlus /> Save
        </Button>
        {analysis && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <MoveRight /> Move
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-72 overflow-y-auto">
              <DropdownMenuLabel>Move to mission</DropdownMenuLabel>
              {analysis.missions
                .filter((m) => m.id !== v?.missionId)
                .map((m) => (
                  <DropdownMenuItem key={m.id} onSelect={() => act(rpc('moveTabToMission', { tabId, missionId: m.id }))}>
                    <span className="size-2 rounded-full" style={{ background: GROUP_COLOR_VAR[m.color] }} />
                    {m.name}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-destructive"
          onClick={async () => {
            if (record?.formStarted && !confirm(`“${tab.title}” has a form you started filling in. Archive it anyway?`)) return;
            await act(rpc('archiveTabs', { tabIds: [tabId] }));
            close?.();
          }}
        >
          <Archive /> Archive
        </Button>
      </div>
      <SaveDialog open={saveOpen} onOpenChange={setSaveOpen} page={{ url: tab.url ?? '', title: tab.title ?? '', favIconUrl: tab.favIconUrl, tabId }} />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-display text-[14px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Activity({ record, openerTitle }: { record: TabRecord; openerTitle?: string }) {
  const now = Date.now();
  const rows: [string, React.ReactNode][] = [
    ['First seen', record.hasHistory ? formatAgo(now - record.openedAt) : 'Before TabLens was installed'],
    ['Last used', formatAgo(now - record.lastAccessed)],
    ['Visits', <span className="tabular">{record.activations}</span>],
    ['Active time', <span className="tabular">{formatDuration(record.activeMs)}</span>],
    ['Read depth', <ReadDepth value={record.maxScroll} />],
    ['Clicks and keys', <span className="tabular">{record.interactions}</span>],
  ];
  if (openerTitle) rows.splice(1, 0, ['Opened from', <span className="line-clamp-1">{openerTitle}</span>]);
  if (record.formStarted) rows.push(['Form', <span className="font-medium text-unfinished">Started, not submitted</span>]);
  return (
    <>
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        {rows.map(([k, val]) => (
          <React.Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0">{val}</dd>
          </React.Fragment>
        ))}
      </dl>
      <VisitSparkline visits={record.visits} />
    </>
  );
}

/** Visits per day over the last two weeks. */
function VisitSparkline({ visits }: { visits: number[] }) {
  const days = 14;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime() - (days - 1) * DAY;
  const counts = new Array(days).fill(0) as number[];
  for (const v of visits) {
    const i = Math.floor((v - startMs) / DAY);
    if (i >= 0 && i < days) counts[i]!++;
  }
  const max = Math.max(1, ...counts);
  return (
    <div className="mt-3">
      <div className="mb-1 text-[12px] text-muted-foreground">Visits, last 14 days</div>
      <div className="flex h-8 items-end gap-[3px]" role="img" aria-label={`Visits per day: ${counts.join(', ')}`}>
        {counts.map((c, i) => (
          <span key={i} className="flex-1 rounded-[2px] bg-foreground/70" style={{ height: c ? `${Math.max(14, (c / max) * 100)}%` : '2px', opacity: c ? 1 : 0.25 }} />
        ))}
      </div>
    </div>
  );
}

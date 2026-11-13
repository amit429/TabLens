import * as React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookmarkPlus, ExternalLink, FormInput, ShieldCheck } from 'lucide-react';
import { useDashboard } from '../App';
import { SectionHead } from './Overview';
import { Button } from '@/components/ui/button';
import { Favicon, GROUP_COLOR_VAR, ReadDepth, hostOf } from '@/components/tab-bits';
import { SaveDialog, type SavePage } from '@/components/save-dialog';
import { db } from '@/lib/db';
import { rpc } from '@/lib/rpc';
import { act } from '@/lib/ui-actions';
import { formatAgo } from '@/lib/analysis/states';

export default function Unfinished() {
  const { analysis, tabs, openDossier } = useDashboard();
  const records = useLiveQuery(() => db.tabs.toArray(), []) ?? [];
  const rec = new Map(records.map((r) => [r.tabId, r]));
  const [save, setSave] = React.useState<SavePage | null>(null);
  const list = tabs.filter((t) => analysis?.verdicts[t.id!]?.state === 'unfinished' || analysis?.verdicts[t.id!]?.flags.includes('unfinished'));
  const byMission = new Map<string, chrome.tabs.Tab[]>();
  for (const t of list) {
    const mid = analysis!.verdicts[t.id!]!.missionId;
    byMission.set(mid, [...(byMission.get(mid) ?? []), t]);
  }

  if (!list.length)
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <ShieldCheck className="mx-auto size-8 text-unfinished" />
        <h2 className="mt-3 font-display text-[20px] font-semibold">No unfinished work</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">
          When you start a form or stop halfway through an article, the tab shows up here and is never suggested for cleanup until you finish or save it.
        </p>
      </div>
    );

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <p className="text-[14px] text-muted-foreground">These tabs hold work in progress. TabLens will never put them in a cleanup plan, and archiving one asks you to confirm by name.</p>
      {[...byMission.entries()].map(([mid, ts]) => {
        const m = analysis!.missions.find((x) => x.id === mid);
        return (
          <section key={mid}>
            <SectionHead
              title={m?.name ?? 'Unsorted'}
              action={m && <span className="size-2.5 rounded-full" style={{ background: GROUP_COLOR_VAR[m.color] }} />}
            />
            <ul className="divide-y divide-border rounded-[12px] border border-border bg-card">
              {ts.map((t) => {
                const r = rec.get(t.id!);
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Favicon url={t.url} favIconUrl={t.favIconUrl} />
                    <button className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => openDossier(t.id!)}>
                      <span className="block truncate text-[14px] font-medium">{t.title}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-[12px] text-muted-foreground">
                        {hostOf(t.url)}
                        {r && <>· last used {formatAgo(Date.now() - r.lastAccessed)}</>}
                        {r?.formStarted && (
                          <span className="inline-flex items-center gap-1 font-medium text-unfinished">
                            <FormInput className="size-3" /> Form started
                          </span>
                        )}
                      </span>
                    </button>
                    {!!r?.maxScroll && <ReadDepth value={r.maxScroll} />}
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => rpc('openTab', { tabId: t.id! })}>
                        <ExternalLink /> Open
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setSave({ url: t.url ?? '', title: t.title ?? '', favIconUrl: t.favIconUrl, tabId: t.id })}>
                        <BookmarkPlus /> Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => act(rpc('setKeep', { tabIds: [t.id!], keep: true }), { success: 'Kept' })}>
                        Keep
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {save && <SaveDialog open onOpenChange={(o) => !o && setSave(null)} page={save} />}
    </div>
  );
}

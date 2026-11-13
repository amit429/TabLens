import * as React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlarmClock, AppWindow, RotateCcw, Search, Trash2 } from 'lucide-react';
import { SectionHead } from './Overview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Favicon, StateChip, hostOf } from '@/components/tab-bits';
import { db } from '@/lib/db';
import { rpc } from '@/lib/rpc';
import { act } from '@/lib/ui-actions';
import { formatAgo } from '@/lib/analysis/states';
import { useNow } from '@/hooks/data';
import type { ArchiveEntry } from '@/lib/types';

export default function ArchivePage() {
  const entries = useLiveQuery(() => db.archive.orderBy('archivedAt').reverse().toArray(), []) ?? [];
  const [q, setQ] = React.useState('');
  const now = useNow(30_000);
  const snoozed = entries.filter((e) => e.snoozeUntil);
  const archived = entries.filter((e) => !e.snoozeUntil && (!q || `${e.title} ${e.url} ${e.missionName}`.toLowerCase().includes(q.toLowerCase())));

  // Group archived tabs into missions (by mission name + same click).
  const batches = new Map<string, ArchiveEntry[]>();
  for (const e of archived) {
    const key = e.missionName ? `${e.missionName}|${e.batchId}` : `|${e.batchId}`;
    batches.set(key, [...(batches.get(key) ?? []), e]);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      {!!snoozed.length && (
        <section>
          <SectionHead title="Snoozed" hint="These reopen on their own at the time you picked." />
          <ul className="divide-y divide-border rounded-[12px] border border-border bg-card">
            {snoozed.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                <Favicon url={e.url} favIconUrl={e.favIconUrl} />
                <span className="min-w-0 flex-1 truncate text-[13px]">{e.title}</span>
                <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                  <AlarmClock className="size-3.5" /> {countdown(e.snoozeUntil! - now)}
                </span>
                <Button size="sm" variant="outline" onClick={() => act(rpc('restoreArchive', { ids: [e.id] }).then((r) => ({ count: r.opened, message: 'Woke it up' })))}>
                  Wake now
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionHead
          title="Archived"
          hint="Every tab TabLens closed for you. Restore single tabs, or resume a whole mission in a new window."
          action={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the archive" className="w-56 pl-8" />
            </div>
          }
        />
        {!archived.length && (
          <div className="rounded-[12px] border border-dashed border-border px-4 py-12 text-center text-[13px] text-muted-foreground">
            {q ? 'Nothing in the archive matches.' : 'Nothing archived yet. Tabs you archive land here and stay until you delete them.'}
          </div>
        )}
        <div className="space-y-4">
          {[...batches.entries()].map(([key, list]) => {
            const mission = key.split('|')[0];
            return (
              <div key={key} className="overflow-hidden rounded-[12px] border border-border bg-card">
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{mission || 'Archived tabs'}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {list.length} tab{list.length === 1 ? '' : 's'} · archived {formatAgo(now - list[0]!.archivedAt)}
                    </div>
                  </div>
                  {list.length > 1 && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => act(rpc('restoreArchive', { ids: list.map((e) => e.id), newWindow: true }).then((r) => ({ count: r.opened, message: `Resumed ${r.opened} tabs in a new window` })))}>
                        <AppWindow /> Resume in new window
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => act(rpc('restoreArchive', { ids: list.map((e) => e.id) }).then((r) => ({ count: r.opened, message: `Restored ${r.opened} tabs` })))}>
                        <RotateCcw /> Restore all
                      </Button>
                    </>
                  )}
                </div>
                <ul className="divide-y divide-border">
                  {list.map((e) => (
                    <li key={e.id} className="group flex items-center gap-3 px-4 py-2">
                      <Favicon url={e.url} favIconUrl={e.favIconUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px]">{e.title}</div>
                        <div className="truncate text-[12px] text-muted-foreground">
                          {hostOf(e.url)}
                          {e.reason && ` · ${e.reason}`}
                        </div>
                      </div>
                      {e.lastState && <StateChip state={e.lastState} />}
                      <Button size="sm" variant="ghost" onClick={() => act(rpc('restoreArchive', { ids: [e.id] }).then(() => ({ count: 1, message: 'Restored' })))}>
                        <RotateCcw /> Restore
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete from archive"
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => act(rpc('deleteArchive', { ids: [e.id] }).then(() => ({ count: 1, message: 'Deleted from archive' })))}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function countdown(ms: number) {
  if (ms <= 0) return 'any moment';
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 48) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
}

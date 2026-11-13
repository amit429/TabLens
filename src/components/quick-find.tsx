import * as React from 'react';
import { Command } from 'cmdk';
import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, Bookmark, Search, AppWindow } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Favicon, StateDot, hostOf } from './tab-bits';
import { db } from '@/lib/db';
import { rpc } from '@/lib/rpc';
import { normalizeUrl } from '@/lib/url';
import { formatAgo } from '@/lib/analysis/states';
import type { Analysis } from '@/lib/types';
import { cn } from '@/lib/cn';

/** Searches open tabs (title, URL, mission, page content), the archive and saved pages. */
export function QuickFindList({ analysis, onDone, autoFocus = true, className }: { analysis: Analysis | null | undefined; onDone?: () => void; autoFocus?: boolean; className?: string }) {
  const [tabs, setTabs] = React.useState<chrome.tabs.Tab[]>([]);
  React.useEffect(() => {
    chrome.tabs.query({}).then((t) => setTabs(t.filter((x) => !(x.url ?? '').startsWith('chrome-extension://' + chrome.runtime.id))));
  }, []);
  const snaps = useLiveQuery(() => db.snapshots.toArray(), []) ?? [];
  const archive = useLiveQuery(() => db.archive.orderBy('archivedAt').reverse().limit(300).toArray(), []) ?? [];
  const saves = useLiveQuery(() => db.saves.toArray(), []) ?? [];
  const snapByUrl = React.useMemo(() => new Map(snaps.map((s) => [s.normUrl, s])), [snaps]);
  const missionName = (id: number) => {
    const v = analysis?.verdicts[id];
    return analysis?.missions.find((m) => m.id === v?.missionId)?.name;
  };
  const now = Date.now();

  return (
    <Command className={cn('flex flex-col', className)} loop>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 text-muted-foreground" />
        <Command.Input autoFocus={autoFocus} placeholder="Find a tab, archived page or save…" className="h-11 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/70" />
      </div>
      <Command.List className="max-h-[380px] overflow-y-auto p-1.5 scrollbar-thin">
        <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted-foreground">Nothing matches. Try words from the page, not just the title.</Command.Empty>
        <Command.Group heading="Open tabs" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-muted-foreground">
          {tabs.map((t) => {
            const snap = snapByUrl.get(normalizeUrl(t.url ?? ''));
            const v = analysis?.verdicts[t.id!];
            const m = missionName(t.id!);
            return (
              <Item
                key={t.id}
                value={`tab-${t.id} ${t.title} ${t.url}`}
                keywords={[m ?? '', snap?.description ?? '', ...(snap?.keywords ?? []), ...(snap?.headings.slice(0, 6) ?? [])]}
                onSelect={() => {
                  rpc('openTab', { tabId: t.id! });
                  onDone?.();
                }}
              >
                <Favicon url={t.url} favIconUrl={t.favIconUrl} />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                {m && <span className="max-w-32 truncate text-[11px] text-muted-foreground">{m}</span>}
                {v ? <StateDot state={v.state} /> : <AppWindow className="size-3 text-muted-foreground" />}
              </Item>
            );
          })}
        </Command.Group>
        {!!saves.length && (
          <Command.Group heading="Saved" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-muted-foreground">
            {saves.map((s) => (
              <Item
                key={s.id}
                value={`save-${s.id} ${s.title} ${s.url}`}
                keywords={[s.note, s.intent]}
                onSelect={() => {
                  rpc('openUrl', { url: s.url });
                  onDone?.();
                }}
              >
                <Bookmark className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="max-w-40 truncate text-[11px] text-muted-foreground">{s.note || hostOf(s.url)}</span>
              </Item>
            ))}
          </Command.Group>
        )}
        {!!archive.length && (
          <Command.Group heading="Archived" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-muted-foreground">
            {archive.map((e) => (
              <Item
                key={e.id}
                value={`archive-${e.id} ${e.title} ${e.url}`}
                keywords={[e.missionName ?? '']}
                onSelect={() => {
                  rpc('restoreArchive', { ids: [e.id] });
                  onDone?.();
                }}
              >
                <Archive className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                <span className="text-[11px] text-muted-foreground">{formatAgo(now - e.archivedAt)}</span>
              </Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command>
  );
}

function Item(props: React.ComponentProps<typeof Command.Item>) {
  return <Command.Item {...props} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-[8px] px-2 text-[13px] data-[selected=true]:bg-muted" />;
}

export function QuickFindDialog({ open, onOpenChange, analysis }: { open: boolean; onOpenChange: (o: boolean) => void; analysis: Analysis | null | undefined }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
        <DialogPrimitive.Content aria-describedby={undefined} className="fixed left-1/2 top-[14vh] z-50 w-[calc(100%-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-[16px] border border-border bg-popover shadow-2xl data-[state=open]:animate-[pop-in_.15s_ease-out]">
          <DialogPrimitive.Title className="sr-only">Quick find</DialogPrimitive.Title>
          <QuickFindList analysis={analysis} onDone={() => onOpenChange(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** ⌘K / Ctrl+K opens quick find. */
export function useQuickFindHotkey(setOpen: (fn: (o: boolean) => boolean) => void) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}

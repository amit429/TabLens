import * as React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BellRing, BookMarked, ExternalLink, FolderInput, NotebookPen, Search, Tag, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { SectionHead } from './Overview';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Favicon, hostOf } from '@/components/tab-bits';
import { INTENT_ICON } from '@/components/save-dialog';
import { INTENTS, SAVES_FOLDER, loadLibrary, topicShelves, type LibraryItem } from '@/lib/library';
import { db } from '@/lib/db';
import { rpc } from '@/lib/rpc';
import { formatAgo } from '@/lib/analysis/states';
import { cn } from '@/lib/cn';
import type { SaveIntent } from '@/lib/types';

type View = 'topic' | 'folder' | 'intent';
type Filter = 'never' | 'stale' | 'dupes' | 'week' | 'remind';

const FILTERS: { id: Filter; label: string; test: (i: LibraryItem, now: number) => boolean }[] = [
  { id: 'never', label: 'Never opened since saved', test: (i) => !i.lastSeenAt || (i.addedAt !== undefined && i.lastSeenAt - i.addedAt < 60_000) },
  { id: 'stale', label: 'Not seen in 90 days', test: (i, now) => !i.lastSeenAt || now - i.lastSeenAt > 90 * 86_400_000 },
  { id: 'dupes', label: 'Duplicates', test: (i) => i.duplicate },
  { id: 'week', label: 'Saved this week', test: (i, now) => !!i.addedAt && now - i.addedAt < 7 * 86_400_000 },
  { id: 'remind', label: 'With reminders', test: (i) => !!i.remindAt },
];

function useBookmarkAccess() {
  const [has, setHas] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    const check = () => chrome.permissions.contains({ permissions: ['bookmarks'] }).then(setHas);
    check();
    chrome.permissions.onAdded.addListener(check);
    return () => chrome.permissions.onAdded.removeListener(check);
  }, []);
  return has;
}

function useLibrary(access: boolean | null) {
  const [items, setItems] = React.useState<LibraryItem[] | null>(null);
  const savesVersion = useLiveQuery(async () => `${await db.saves.count()}:${(await db.saves.toArray()).map((s) => s.note + s.intent).join('|').length}:${(await db.bookmarkMeta.toArray()).map((m) => (m.note ?? '') + (m.intent ?? '')).join('|')}`, []);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    loadLibrary().then(setItems);
  }, [access, savesVersion, tick]);
  React.useEffect(() => {
    if (!access) return;
    const bump = () => setTick((t) => t + 1);
    const evs = [chrome.bookmarks.onCreated, chrome.bookmarks.onRemoved, chrome.bookmarks.onChanged, chrome.bookmarks.onMoved] as chrome.events.Event<() => void>[];
    evs.forEach((e) => e.addListener(bump));
    return () => evs.forEach((e) => e.removeListener(bump));
  }, [access]);
  return items;
}

export default function Library() {
  const access = useBookmarkAccess();
  const items = useLibrary(access);
  const [view, setView] = React.useState<View>('topic');
  const [q, setQ] = React.useState('');
  const [filters, setFilters] = React.useState<Set<Filter>>(new Set());
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const now = Date.now();

  const filtered = React.useMemo(() => {
    if (!items) return [];
    return items.filter((i) => {
      if (q && !`${i.title} ${i.url} ${i.note ?? ''} ${i.folder}`.toLowerCase().includes(q.toLowerCase())) return false;
      for (const f of filters) if (!FILTERS.find((x) => x.id === f)!.test(i, now)) return false;
      return true;
    });
  }, [items, q, filters, now]);

  const shelves = React.useMemo(() => {
    if (view === 'topic') return topicShelves(filtered);
    if (view === 'folder') {
      const m = new Map<string, LibraryItem[]>();
      for (const i of filtered) m.set(i.folder, [...(m.get(i.folder) ?? []), i]);
      return [...m.entries()].sort((a, b) => b[1].length - a[1].length).map(([name, items]) => ({ name, items }));
    }
    const m = new Map<string, LibraryItem[]>();
    for (const i of filtered) {
      const label = INTENTS.find((x) => x.id === i.intent)?.label ?? 'No reason given';
      m.set(label, [...(m.get(label) ?? []), i]);
    }
    return [...m.entries()].sort((a, b) => Number(a[0] === 'No reason given') - Number(b[0] === 'No reason given') || b[1].length - a[1].length).map(([name, items]) => ({ name, items }));
  }, [filtered, view]);

  const toggle = (key: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
  const selectedItems = (items ?? []).filter((i) => selected.has(i.key));

  return (
    <div className="mx-auto max-w-6xl">
      {access === false && <BookmarkAccessBanner />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'topic', label: 'By topic' },
            { value: 'folder', label: 'By folder' },
            { value: 'intent', label: 'By reason' },
          ]}
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, notes, folders" className="w-64 pl-8" />
        </div>
        <span className="tabular ml-auto text-[13px] text-muted-foreground">
          {filtered.length} of {items?.length ?? 0}
        </span>
      </div>
      <div className="mb-6 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const on = filters.has(f.id);
          const n = (items ?? []).filter((i) => f.test(i, now)).length;
          return (
            <button
              key={f.id}
              aria-pressed={on}
              onClick={() =>
                setFilters((s) => {
                  const x = new Set(s);
                  if (on) x.delete(f.id);
                  else x.add(f.id);
                  return x;
                })
              }
              className={cn('inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12px]', on ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted')}
            >
              {f.label}
              <span className={cn('tabular', on ? 'text-background/70' : 'text-muted-foreground')}>{n}</span>
            </button>
          );
        })}
      </div>

      {items === null ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-[12px] bg-muted" />
          ))}
        </div>
      ) : !items.length ? (
        <EmptyLibrary />
      ) : (
        <div className="columns-1 gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {shelves.map((s) => (
            <Shelf key={s.name} name={s.name} items={s.items} selected={selected} onToggle={toggle} now={now} />
          ))}
        </div>
      )}

      {!!selectedItems.length && <BulkBar items={selectedItems} clear={() => setSelected(new Set())} />}
    </div>
  );
}

function Shelf({ name, items, selected, onToggle, now }: { name: string; items: LibraryItem[]; selected: Set<string>; onToggle: (k: string, on: boolean) => void; now: number }) {
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded ? items : items.slice(0, 8);
  const unseen = items.filter((i) => FILTERS[0]!.test(i, now)).length;
  return (
    <section className="overflow-hidden rounded-[14px] border border-border bg-card">
      <header className="flex items-baseline gap-2 border-b border-border px-4 py-3">
        <h3 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold">{name}</h3>
        <span className="tabular text-[12px] text-muted-foreground">
          {items.length}
          {unseen ? ` · ${unseen} never opened` : ''}
        </span>
      </header>
      <ul className="divide-y divide-border">
        {shown.map((i) => (
          <Row key={i.key} item={i} checked={selected.has(i.key)} onCheck={(on) => onToggle(i.key, on)} now={now} />
        ))}
      </ul>
      {items.length > 8 && (
        <button onClick={() => setExpanded(!expanded)} className="w-full cursor-pointer border-t border-border py-2 text-[12px] font-medium text-muted-foreground hover:bg-muted/50">
          {expanded ? 'Show fewer' : `Show ${items.length - 8} more`}
        </button>
      )}
    </section>
  );
}

function Row({ item: i, checked, onCheck, now }: { item: LibraryItem; checked: boolean; onCheck: (on: boolean) => void; now: number }) {
  const intent = INTENTS.find((x) => x.id === i.intent);
  const Icon = i.intent ? INTENT_ICON[i.intent] : null;
  const seen = i.lastSeenAt && (!i.addedAt || i.lastSeenAt - i.addedAt > 60_000) ? `seen ${formatAgo(now - i.lastSeenAt)}` : 'never opened since';
  return (
    <li className={cn('group flex items-start gap-3 px-4 py-2.5', checked && 'bg-accent-soft/50')}>
      <Checkbox className="mt-0.5" checked={checked} onCheckedChange={(c) => onCheck(c === true)} aria-label={`Select ${i.title}`} />
      <Favicon url={i.url} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <a href={i.url} target="_blank" rel="noreferrer" className="line-clamp-1 text-[13px] font-medium hover:underline">
          {i.title}
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
          <span>{hostOf(i.url)}</span>
          {i.addedAt && <span>saved {formatAgo(now - i.addedAt)}</span>}
          <span className={cn(seen.startsWith('never') && 'text-stale')}>{seen}</span>
          {i.duplicate && <span className="text-duplicate">duplicate</span>}
          {i.remindAt && i.remindAt > now && (
            <span className="inline-flex items-center gap-1">
              <BellRing className="size-3" /> {new Date(i.remindAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        {i.note && <p className="mt-1 line-clamp-2 border-l-2 border-border pl-2 text-[12px] italic text-muted-foreground">{i.note}</p>}
      </div>
      <IntentPicker item={i}>
        <button className={cn('inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-[11px] font-medium', intent ? 'bg-muted' : 'border border-dashed border-border text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}>
          {Icon && <Icon className="size-3" />}
          {intent?.label ?? 'Why?'}
        </button>
      </IntentPicker>
      <NoteEditor item={i} />
    </li>
  );
}

async function setMeta(items: LibraryItem[], patch: { intent?: SaveIntent; note?: string }) {
  for (const i of items) {
    if (i.saveId) await db.saves.update(i.saveId, patch);
    if (i.bookmarkId) {
      const m = await db.bookmarkMeta.get(i.bookmarkId);
      await db.bookmarkMeta.put({ ...(m ?? { bookmarkId: i.bookmarkId }), ...patch });
    }
  }
}

function IntentPicker({ item, children }: { item: LibraryItem; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Why did you save it?</DropdownMenuLabel>
        {INTENTS.map((x) => {
          const I = INTENT_ICON[x.id];
          return (
            <DropdownMenuItem key={x.id} onSelect={() => setMeta([item], { intent: x.id })}>
              <I /> {x.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NoteEditor({ item }: { item: LibraryItem }) {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState(item.note ?? '');
  React.useEffect(() => setNote(item.note ?? ''), [item.note]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Edit note" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
          <NotebookPen />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <div className="mb-2 text-[13px] font-medium">Note for future you</div>
        <Textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it matters, what to do with it" />
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              await setMeta([item], { note: note.trim() });
              setOpen(false);
              toast('Note saved');
            }}
          >
            Save note
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BulkBar({ items, clear }: { items: LibraryItem[]; clear: () => void }) {
  const [folders, setFolders] = React.useState<{ id: string; title: string }[]>([]);
  React.useEffect(() => {
    chrome.permissions.contains({ permissions: ['bookmarks'] }).then(async (ok) => {
      if (!ok) return;
      const out: { id: string; title: string }[] = [];
      const walk = (ns: chrome.bookmarks.BookmarkTreeNode[], depth: number) => {
        for (const n of ns) {
          if (n.url) continue;
          if (n.title) out.push({ id: n.id, title: `${'  '.repeat(Math.max(0, depth - 1))}${n.title}` });
          if (n.children) walk(n.children, depth + 1);
        }
      };
      walk(await chrome.bookmarks.getTree(), 0);
      setFolders(out);
    });
  }, []);
  const bookmarks = items.filter((i) => i.bookmarkId);
  const remove = async () => {
    if (!confirm(`Delete ${items.length} item${items.length === 1 ? '' : 's'} from your bookmarks and library? This can't be undone.`)) return;
    for (const i of items) {
      if (i.bookmarkId) await chrome.bookmarks.remove(i.bookmarkId).catch(() => {});
      if (i.saveId) await db.saves.delete(i.saveId);
    }
    toast(`Deleted ${items.length}`);
    clear();
  };
  return (
    <div className="fixed inset-x-0 bottom-5 z-30 mx-auto flex w-fit max-w-[calc(100%-32px)] flex-wrap items-center gap-2 rounded-[14px] border border-border bg-popover px-3 py-2 shadow-2xl">
      <span className="tabular px-1 text-[13px] font-medium">{items.length} selected</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <Tag /> Set reason
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {INTENTS.map((x) => {
            const I = INTENT_ICON[x.id];
            return (
              <DropdownMenuItem
                key={x.id}
                onSelect={async () => {
                  await setMeta(items, { intent: x.id });
                  toast(`Marked ${items.length} as ${x.label}`);
                }}
              >
                <I /> {x.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {!!bookmarks.length && !!folders.length && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <FolderInput /> Move to folder
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-80 overflow-y-auto">
            {folders.map((f) => (
              <DropdownMenuItem
                key={f.id}
                onSelect={async () => {
                  for (const b of bookmarks) await chrome.bookmarks.move(b.bookmarkId!, { parentId: f.id });
                  toast(`Moved ${bookmarks.length} to ${f.title.trim()}`);
                  clear();
                }}
              >
                <span className="whitespace-pre">{f.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button size="sm" variant="outline" onClick={() => items.forEach((i) => rpc('openUrl', { url: i.url }))}>
        <ExternalLink /> Open all
      </Button>
      <Button size="sm" variant="ghost" className="text-destructive" onClick={remove}>
        <Trash2 /> Delete
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Clear selection" onClick={clear}>
        <X />
      </Button>
    </div>
  );
}

function BookmarkAccessBanner() {
  return (
    <section className="mb-8 rounded-[16px] border border-border bg-card p-6">
      <div className="flex flex-wrap items-start gap-5">
        <BookMarked className="size-8 text-accent" />
        <div className="min-w-64 flex-1">
          <h2 className="font-display text-[20px] font-semibold">Your bookmarks, with the reason you saved them</h2>
          <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
            TabLens sorts your bookmarks into topics, shows when you last opened each one, and lets you note why you saved it. It needs read access to your bookmarks; nothing leaves this device.
          </p>
          <Button
            className="mt-4"
            onClick={async () => {
              const ok = await chrome.permissions.request({ permissions: ['bookmarks'] });
              if (ok) toast('Bookmarks connected');
            }}
          >
            Allow bookmark access
          </Button>
        </div>
      </div>
    </section>
  );
}

function EmptyLibrary() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <SectionHead title="Your library is empty" />
      <p className="text-[14px] text-muted-foreground">
        Use <strong>Save</strong> on any tab (or right-click a page → Save to TabLens) to keep it with a reason and a reminder. Saves also go into a “{SAVES_FOLDER}” bookmarks folder.
      </p>
    </div>
  );
}

import * as React from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, pointerWithin, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Archive, ClipboardCopy, Crosshair, FolderTree, FormInput, GitMerge, MoreHorizontal, Pin, Plus, Search, Sparkles, Volume2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDashboard } from '../App';
import { Spectrum } from '@/components/spectrum';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Favicon, GROUP_COLOR_VAR, ReadDepth, STATE_META, StateChip } from '@/components/tab-bits';
import type { LiveMission, LiveTab } from '@/hooks/data';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { rpc } from '@/lib/rpc';
import { act } from '@/lib/ui-actions';
import { formatAgo } from '@/lib/analysis/states';
import { GROUP_COLORS } from '@/lib/analysis/naming';
import { UNSORTED_ID } from '@/lib/analysis/analyze';
import { cn } from '@/lib/cn';
import type { GroupColor, MissionKind, TabState } from '@/lib/types';

const NEW_ID = '__new';
const ARCHIVE_ZONE = '__archive';
const NEW_MISSION_ZONE = '__new-mission';

type Columns = Record<string, number[]>;

export default function Board() {
  const { analysis, live, tabs, openDossier } = useDashboard();
  const [kind, setKind] = React.useState<'all' | MissionKind>('all');
  const [query, setQuery] = React.useState('');
  const [stateFilter, setStateFilter] = React.useState<TabState | null>(null);
  const [activeId, setActiveId] = React.useState<number | null>(null);
  const [newMissionFor, setNewMissionFor] = React.useState<number[] | null>(null);
  const records = useLiveQuery(() => db.tabs.toArray(), []) ?? [];
  const recById = React.useMemo(() => new Map(records.map((r) => [r.tabId, r])), [records]);

  const tabById = React.useMemo(() => new Map(tabs.map((t) => [t.id!, t])), [tabs]);
  const missions: LiveMission[] = React.useMemo(() => {
    const list = live.missions.filter((m) => m.live.length || m.source === 'user');
    if (live.fresh.length)
      list.push({ id: NEW_ID, name: 'New since last analysis', intent: 'Opened after TabLens last looked. Drag them where they belong, or re-analyse.', kind: 'personal', color: 'grey', tabIds: [], confidence: 0, source: 'heuristic', keywords: [], live: live.fresh });
    return list;
  }, [live]);

  // Local column state so cards move instantly while dragging; resynced whenever data changes.
  const [columns, setColumns] = React.useState<Columns>({});
  React.useEffect(() => {
    setColumns(Object.fromEntries(missions.map((m) => [m.id, m.live.map((l) => l.tab.id!)])));
  }, [missions]);

  const verdictOf = (id: number) => analysis?.verdicts[id];
  const matches = (id: number) => {
    const t = tabById.get(id);
    if (!t) return false;
    if (stateFilter && (verdictOf(id)?.state ?? 'active') !== stateFilter) return false;
    if (query && !`${t.title} ${t.url}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const findContainer = (id: string | number): string | undefined => {
    if (typeof id === 'string' && id in columns) return id;
    return Object.keys(columns).find((k) => columns[k]!.includes(id as number));
  };

  // Drop zones win when the pointer is over them; otherwise nearest card/column.
  const collision: CollisionDetection = (args) => {
    const zones = pointerWithin(args).filter((c) => c.id === ARCHIVE_ZONE || c.id === NEW_MISSION_ZONE);
    return zones.length ? zones : closestCorners(args);
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(e.active.id as number);

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || over.id === ARCHIVE_ZONE || over.id === NEW_MISSION_ZONE) return;
    const from = findContainer(active.id);
    const to = findContainer(over.id);
    if (!from || !to || from === to || to === NEW_ID) return;
    setColumns((c) => {
      const next = { ...c, [from]: c[from]!.filter((x) => x !== active.id) };
      const target = [...c[to]!];
      const overIndex = target.indexOf(over.id as number);
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, active.id as number);
      next[to] = target;
      return next;
    });
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    const tabId = active.id as number;
    if (!over) return;
    if (over.id === ARCHIVE_ZONE) {
      const rec = recById.get(tabId);
      if (rec?.formStarted && !confirm(`“${tabById.get(tabId)?.title}” has a form you started filling in. Archive it anyway?`)) return;
      await act(rpc('archiveTabs', { tabIds: [tabId] }));
      return;
    }
    if (over.id === NEW_MISSION_ZONE) {
      setNewMissionFor([tabId]);
      return;
    }
    const to = findContainer(over.id);
    if (!to || to === NEW_ID) return;
    let list = columns[to]!;
    const oldIndex = list.indexOf(tabId);
    const overIndex = list.indexOf(over.id as number);
    if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex) {
      list = arrayMove(list, oldIndex, overIndex);
      setColumns((c) => ({ ...c, [to]: list }));
    }
    const original = missions.find((m) => m.live.some((l) => l.tab.id === tabId))?.id;
    const idx = list.indexOf(tabId);
    const before = idx >= 0 ? list[idx + 1] : undefined;
    if (original === to && oldIndex === overIndex) return;
    await act(rpc('moveTabToMission', { tabId, missionId: to, beforeTabId: before }));
  };

  if (!analysis) return <div className="h-64 animate-pulse rounded-[12px] bg-muted" />;

  const visible = missions.filter((m) => kind === 'all' || m.id === UNSORTED_ID || m.id === NEW_ID || m.kind === kind);
  const activeTab = activeId !== null ? tabById.get(activeId) : undefined;
  const ungrouped = visible.filter((m) => m.id !== UNSORTED_ID && m.id !== NEW_ID && m.live.length > 1 && !(m.groupId !== undefined && m.live.every((l) => l.tab.groupId === m.groupId)));

  return (
    <div className="-mx-4 md:-mx-8">
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 md:px-8">
        <Segmented value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'work', label: 'Work' }, { value: 'personal', label: 'Personal' }]} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter cards" className="w-48 pl-8" />
        </div>
        <div className="flex flex-wrap gap-1">
          {(['stale', 'abandoned', 'duplicate', 'unfinished'] as TabState[]).map((s) => (
            <button
              key={s}
              onClick={() => setStateFilter(stateFilter === s ? null : s)}
              aria-pressed={stateFilter === s}
              className={cn('inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px]', stateFilter === s ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted')}
            >
              <span className="size-1.5 rounded-full" style={{ background: STATE_META[s].color }} />
              {STATE_META[s].label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setNewMissionFor([])}>
            <Plus /> New mission
          </Button>
          {!!ungrouped.length && (
            <Button onClick={() => act(rpc('groupMissions', { missionIds: ungrouped.map((m) => m.id) }))}>
              <FolderTree /> Group {ungrouped.length} in Chrome
            </Button>
          )}
        </div>
      </div>
      <p className="px-4 pb-3 text-[12px] text-muted-foreground md:px-8">Drag a card to another mission and the real tab moves into that Chrome tab group. TabLens remembers the move for next time.</p>

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="flex items-start gap-3 overflow-x-auto px-4 pb-24 scrollbar-thin md:px-8">
          {visible.map((m) => (
            <Column
              key={m.id}
              mission={m}
              ids={(columns[m.id] ?? []).filter(matches)}
              allMissions={missions}
              renderCard={(id) => {
                const t = tabById.get(id);
                if (!t) return null;
                return <SortableCard key={id} id={id} tab={t} verdictState={verdictOf(id)?.state} record={recById.get(id)} onOpen={() => openDossier(id)} />;
              }}
            />
          ))}
        </div>
        <DropZones visible={activeId !== null} />
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
          {activeTab ? <TabCard tab={activeTab} state={verdictOf(activeTab.id!)?.state} record={recById.get(activeTab.id!)} lifted /> : null}
        </DragOverlay>
      </DndContext>

      <NewMissionDialog tabIds={newMissionFor} onClose={() => setNewMissionFor(null)} />
    </div>
  );
}

function Column({ mission: m, ids, renderCard, allMissions }: { mission: LiveMission; ids: number[]; renderCard: (id: number) => React.ReactNode; allMissions: LiveMission[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: m.id, disabled: m.id === NEW_ID });
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(m.name);
  React.useEffect(() => setName(m.name), [m.name]);
  const special = m.id === UNSORTED_ID || m.id === NEW_ID;
  const canGo = m.live.filter((l) => l.verdict?.verdict === 'archive' || l.verdict?.verdict === 'close-duplicate').length;
  const grouped = m.groupId !== undefined && m.live.length > 0 && m.live.every((l) => l.tab.groupId === m.groupId);

  const commit = async () => {
    setEditing(false);
    if (name.trim() && name.trim() !== m.name) await act(rpc('renameMission', { missionId: m.id, name: name.trim() }), { success: `Renamed to ${name.trim()}` });
  };

  return (
    <section
      ref={setNodeRef}
      aria-label={m.name}
      className={cn('flex max-h-[calc(100vh-200px)] w-[296px] shrink-0 flex-col rounded-[14px] border bg-card transition-colors', isOver ? 'border-accent ring-2 ring-accent/20' : 'border-border', special && 'bg-muted/40')}
    >
      <header className="space-y-2 border-b border-border p-3">
        <div className="flex items-center gap-2">
          {special ? (
            <span className="size-3 rounded-full border-2 border-dashed border-muted-foreground/50" />
          ) : (
            <ColorPicker value={m.color} onChange={(c) => act(rpc('recolorMission', { missionId: m.id, color: c }), { success: 'Colour updated' })} />
          )}
          {editing && !special ? (
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') {
                  setName(m.name);
                  setEditing(false);
                }
              }}
              className="h-7 flex-1 px-1.5 font-display text-[14px] font-semibold"
            />
          ) : (
            <h3
              className={cn('min-w-0 flex-1 truncate font-display text-[14px] font-semibold', !special && 'cursor-text')}
              onDoubleClick={() => !special && setEditing(true)}
              title={special ? m.name : `${m.name} — double-click to rename`}
            >
              {m.name}
            </h3>
          )}
          <span className="tabular text-[12px] text-muted-foreground">{m.live.length}</span>
          {!special && <ColumnMenu mission={m} allMissions={allMissions} onRename={() => setEditing(true)} />}
        </div>
        <div className="flex items-center gap-1.5">
          {!special && <Badge variant="outline">{m.kind === 'work' ? 'Work' : 'Personal'}</Badge>}
          {m.source === 'model' && (
            <Tooltip content="Named by Gemini">
              <Sparkles className="size-3.5 text-muted-foreground" />
            </Tooltip>
          )}
          {grouped && <Badge variant="accent">In Chrome group</Badge>}
        </div>
        {m.live.length > 0 && <Spectrum items={m.live.map((l) => ({ id: l.tab.id!, title: l.tab.title ?? '', url: l.tab.url, state: l.verdict?.state ?? 'active' }))} height={8} className="rounded-full" />}
        {(m.insight || m.intent) && <p className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{m.insight ?? m.intent}</p>}
      </header>
      <SortableContext id={m.id} items={ids} strategy={verticalListSortingStrategy}>
        <ul className="min-h-16 flex-1 space-y-1.5 overflow-y-auto p-2 scrollbar-thin">
          {ids.map(renderCard)}
          {!ids.length && <li className="rounded-[8px] border border-dashed border-border px-3 py-5 text-center text-[12px] text-muted-foreground">Drop tabs here</li>}
        </ul>
      </SortableContext>
      {!special && m.live.length > 0 && (
        <footer className="flex gap-1.5 border-t border-border p-2">
          {!grouped && m.live.length > 1 && (
            <Button size="sm" variant="soft" className="flex-1" onClick={() => act(rpc('groupMissions', { missionIds: [m.id] }))}>
              <FolderTree /> Group in Chrome
            </Button>
          )}
          {canGo > 0 && (
            <Button size="sm" variant="soft" className="flex-1" onClick={() => act(rpc('archiveMission', { missionId: m.id, onlyStale: true }))}>
              <Archive /> Archive {canGo}
            </Button>
          )}
          {grouped && !canGo && (
            <Button size="sm" variant="soft" className="flex-1" onClick={() => act(rpc('focusMission', { missionId: m.id }).then((r) => ({ count: 0, message: r.focused ? `Focusing on ${m.name}` : 'Focus off' })))}>
              <Crosshair /> Focus
            </Button>
          )}
        </footer>
      )}
    </section>
  );
}

function ColumnMenu({ mission: m, allMissions, onRename }: { mission: LiveMission; allMissions: LiveMission[]; onRename: () => void }) {
  const exportMd = async () => {
    const lines = [`## ${m.name}`, m.intent && `_${m.intent}_`, '', ...m.live.map((l) => `- [${l.tab.title}](${l.tab.url})`)].filter((x) => x !== undefined);
    await navigator.clipboard.writeText(lines.join('\n'));
    toast(`Copied ${m.live.length} links as Markdown`);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${m.name} options`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => act(rpc('focusMission', { missionId: m.id }).then((r) => ({ count: 0, message: r.focused ? `Focusing on ${m.name}` : 'Focus off' })))}>
          <Crosshair /> Focus on this mission
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => act(rpc('groupMissions', { missionIds: [m.id] }))}>
          <FolderTree /> Group in Chrome
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportMd}>
          <ClipboardCopy /> Copy as Markdown
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <GitMerge /> Merge into
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {allMissions
              .filter((x) => x.id !== m.id && x.id !== UNSORTED_ID && x.id !== NEW_ID)
              .map((x) => (
                <DropdownMenuItem key={x.id} onSelect={() => act(rpc('mergeMissions', { fromId: m.id, intoId: x.id }))}>
                  <span className="size-2 rounded-full" style={{ background: GROUP_COLOR_VAR[x.color] }} />
                  {x.name}
                </DropdownMenuItem>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Protected and unfinished tabs stay open</DropdownMenuLabel>
        <DropdownMenuItem destructive onSelect={() => act(rpc('archiveMission', { missionId: m.id }))}>
          <Archive /> Archive whole mission
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColorPicker({ value, onChange }: { value: GroupColor; onChange: (c: GroupColor) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="size-3 shrink-0 cursor-pointer rounded-full ring-offset-2 ring-offset-card hover:ring-2 hover:ring-border" style={{ background: GROUP_COLOR_VAR[value] }} aria-label="Change colour" />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <div className="flex gap-1.5">
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onChange(c)}
              aria-label={c}
              className={cn('size-6 cursor-pointer rounded-full ring-offset-2 ring-offset-popover', c === value && 'ring-2 ring-foreground')}
              style={{ background: GROUP_COLOR_VAR[c] }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SortableCard({ id, tab, verdictState, record, onOpen }: { id: number; tab: chrome.tabs.Tab; verdictState?: TabState; record?: { maxScroll: number; formStarted: boolean }; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn(isDragging && 'opacity-30')} {...attributes} {...listeners}>
      <TabCard tab={tab} state={verdictState} record={record} onOpen={onOpen} />
    </li>
  );
}

function TabCard({ tab, state, record, onOpen, lifted }: { tab: chrome.tabs.Tab; state?: TabState; record?: { maxScroll: number; formStarted: boolean; lastAccessed?: number }; onOpen?: () => void; lifted?: boolean }) {
  // TabLens's own record is authoritative once it exists (see lastUsed in analysis/states).
  const last = record?.lastAccessed ?? (tab as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed ?? 0;
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onOpen}
      className={cn(
        'group cursor-grab rounded-[8px] border border-border bg-card p-2.5 text-left transition-[border-color,box-shadow] hover:border-input active:cursor-grabbing',
        lifted && 'w-[280px] rotate-[1.5deg] cursor-grabbing shadow-2xl ring-1 ring-black/5',
      )}
      style={state ? { boxShadow: lifted ? undefined : `inset 3px 0 0 ${STATE_META[state].color}` } : undefined}
    >
      <div className="flex items-start gap-2">
        <Favicon url={tab.url} favIconUrl={tab.favIconUrl} className="mt-0.5" />
        <span className="line-clamp-2 flex-1 text-[13px] leading-snug">{tab.title}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 pl-6">
        {state && <StateChip state={state} />}
        {last > 0 && <span className="whitespace-nowrap text-[11px] text-muted-foreground">{formatAgo(Date.now() - last)}</span>}
        <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
          {tab.pinned && <Pin className="size-3" aria-label="Pinned" />}
          {tab.audible && <Volume2 className="size-3" aria-label="Playing audio" />}
          {record?.formStarted && <FormInput className="size-3 text-unfinished" aria-label="Form started" />}
          {!!record?.maxScroll && !record.formStarted && <ReadDepth value={record.maxScroll} />}
        </span>
      </div>
    </div>
  );
}

function DropZones({ visible }: { visible: boolean }) {
  return (
    <div className={cn('pointer-events-none fixed bottom-6 right-6 z-30 flex gap-3 transition-all duration-200', visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0')}>
      <Zone id={NEW_MISSION_ZONE} icon={<Plus className="size-4" />} label="New mission" enabled={visible} />
      <Zone id={ARCHIVE_ZONE} icon={<Archive className="size-4" />} label="Drop to archive" enabled={visible} danger />
    </div>
  );
}

function Zone({ id, icon, label, enabled, danger }: { id: string; icon: React.ReactNode; label: string; enabled: boolean; danger?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !enabled });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'pointer-events-auto flex h-20 w-44 flex-col items-center justify-center gap-1 rounded-[14px] border-2 border-dashed bg-popover text-[13px] font-medium shadow-xl transition-colors',
        isOver ? (danger ? 'border-destructive bg-destructive/10 text-destructive' : 'border-accent bg-accent-soft text-accent') : 'border-input text-muted-foreground',
      )}
    >
      {icon}
      {label}
    </div>
  );
}

function NewMissionDialog({ tabIds, onClose }: { tabIds: number[] | null; onClose: () => void }) {
  const [name, setName] = React.useState('');
  React.useEffect(() => setName(''), [tabIds]);
  const create = async () => {
    if (!name.trim() || !tabIds) return;
    await act(rpc('createMission', { name: name.trim(), tabIds }).then(() => ({ count: tabIds.length, message: `Created ${name.trim()}` })));
    onClose();
  };
  return (
    <Dialog open={tabIds !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>New mission</DialogTitle>
        <DialogDescription>{tabIds?.length ? 'The tab you dropped moves into a new Chrome tab group with this name.' : 'Create an empty mission, then drag tabs into it.'}</DialogDescription>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Planning Goa trip" />
          <Button type="submit" disabled={!name.trim()}>
            Create
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type { LiveTab };

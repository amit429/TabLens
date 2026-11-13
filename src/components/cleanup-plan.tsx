import * as React from 'react';
import { ChevronDown, Copy, Archive, FolderTree, Clock } from 'lucide-react';
import { Checkbox } from './ui/checkbox';
import { Button } from './ui/button';
import { Favicon, GROUP_COLOR_VAR, reasonLine } from './tab-bits';
import { rpc } from '@/lib/rpc';
import { act } from '@/lib/ui-actions';
import { cn } from '@/lib/cn';
import type { Analysis, PlanItem } from '@/lib/types';

const ICON: Record<PlanItem['kind'], typeof Copy> = {
  'close-duplicates': Copy,
  'archive-abandoned': Archive,
  'archive-stale': Clock,
  'group-missions': FolderTree,
};

const LABEL: Record<PlanItem['kind'], (n: number) => string> = {
  'close-duplicates': (n) => `Close ${n} duplicate${n === 1 ? '' : 's'}`,
  'archive-abandoned': (n) => `Archive ${n} abandoned`,
  'archive-stale': (n) => `Archive ${n} stale`,
  'group-missions': (n) => `Group ${n} mission${n === 1 ? '' : 's'}`,
};

const EXPLAIN: Record<PlanItem['kind'], string> = {
  'close-duplicates': 'The other copy stays open.',
  'archive-abandoned': 'Closed and saved to the Archive. Restore any time.',
  'archive-stale': 'Not opened for a few days and barely used.',
  'group-missions': 'Puts each mission into a real Chrome tab group, across all your windows.',
};

/**
 * The proposed actions, each expandable to the tabs it touches with the reason for each.
 * Only checked items run; unfinished and protected tabs are never in here.
 */
export function CleanupPlan({ analysis, tabs, onApplied, className, stickyFooter }: { analysis: Analysis; tabs: chrome.tabs.Tab[]; onApplied?: () => void; className?: string; stickyFooter?: boolean }) {
  const open = React.useMemo(() => new Map(tabs.map((t) => [t.id!, t])), [tabs]);
  const plan = React.useMemo(
    () =>
      analysis.plan
        .map((p) => ({ ...p, tabIds: p.tabIds.filter((id) => open.has(id)), missionIds: p.missionIds?.filter((mid) => analysis.missions.find((m) => m.id === mid)?.tabIds.some((id) => open.has(id))) }))
        .filter((p) => (p.kind === 'group-missions' ? p.missionIds?.length : p.tabIds.length)),
    [analysis, open],
  );

  const [checked, setChecked] = React.useState<Set<number>>(new Set());
  const [missions, setMissions] = React.useState<Set<string>>(new Set());
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setChecked(new Set(plan.filter((p) => p.recommended && p.kind !== 'group-missions').flatMap((p) => p.tabIds)));
    setMissions(new Set(plan.filter((p) => p.recommended && p.kind === 'group-missions').flatMap((p) => p.missionIds ?? [])));
    // Reset only when a new analysis arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis.id]);

  if (!plan.length)
    return (
      <div className={cn('rounded-[12px] border border-dashed border-border px-4 py-6 text-center', className)}>
        <div className="font-display text-[15px] font-semibold">Nothing to clean up</div>
        <p className="mt-1 text-[13px] text-muted-foreground">Every open tab has been used recently or is protected.</p>
      </div>
    );

  const toggleMany = (ids: number[], on: boolean) =>
    setChecked((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });

  const closeIds = plan.filter((p) => p.kind === 'close-duplicates').flatMap((p) => p.tabIds).filter((id) => checked.has(id));
  const archiveIds = plan.filter((p) => p.kind.startsWith('archive')).flatMap((p) => p.tabIds).filter((id) => checked.has(id));
  const groupIds = [...missions];
  const total = closeIds.length + archiveIds.length;

  const apply = async () => {
    setBusy(true);
    await act(rpc('applyPlan', { closeIds, archiveIds, groupMissionIds: groupIds }));
    setBusy(false);
    onApplied?.();
  };

  return (
    <div className={className}>
      <ul className="divide-y divide-border overflow-hidden rounded-[12px] border border-border bg-card">
        {plan.map((p) => {
          const Icon = ICON[p.kind];
          const isGroup = p.kind === 'group-missions';
          const n = isGroup ? p.missionIds!.length : p.tabIds.length;
          const on = isGroup ? p.missionIds!.filter((m) => missions.has(m)).length : p.tabIds.filter((id) => checked.has(id)).length;
          const state = on === 0 ? false : on === n ? true : 'indeterminate';
          const isOpen = expanded === p.id;
          return (
            <li key={p.id}>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <Checkbox
                  checked={state}
                  aria-label={LABEL[p.kind](n)}
                  onCheckedChange={(c) => {
                    if (isGroup) setMissions(c === true ? new Set(p.missionIds) : new Set());
                    else toggleMany(p.tabIds, c === true);
                  }}
                />
                <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left" onClick={() => setExpanded(isOpen ? null : p.id)} aria-expanded={isOpen}>
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{LABEL[p.kind](n)}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{EXPLAIN[p.kind]}</span>
                  </span>
                  {on !== n && on > 0 && <span className="tabular text-[11px] text-muted-foreground">{on} picked</span>}
                  <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                </button>
              </div>
              {isOpen && (
                <ul className="max-h-64 overflow-y-auto border-t border-border bg-muted/30 py-1 scrollbar-thin">
                  {isGroup
                    ? p.missionIds!.map((mid) => {
                        const m = analysis.missions.find((x) => x.id === mid)!;
                        const count = m.tabIds.filter((id) => open.has(id)).length;
                        return (
                          <li key={mid} className="flex items-center gap-3 px-3 py-1.5">
                            <Checkbox
                              checked={missions.has(mid)}
                              onCheckedChange={(c) =>
                                setMissions((s) => {
                                  const x = new Set(s);
                                  if (c === true) x.add(mid);
                                  else x.delete(mid);
                                  return x;
                                })
                              }
                            />
                            <span className="size-2 rounded-full" style={{ background: GROUP_COLOR_VAR[m.color] }} />
                            <span className="min-w-0 flex-1 truncate text-[13px]">{m.name}</span>
                            <span className="tabular text-[12px] text-muted-foreground">{count} tabs</span>
                          </li>
                        );
                      })
                    : p.tabIds.map((id) => {
                        const t = open.get(id)!;
                        const v = analysis.verdicts[id];
                        return (
                          <li key={id} className="flex items-start gap-3 px-3 py-1.5">
                            <Checkbox className="mt-0.5" checked={checked.has(id)} onCheckedChange={(c) => toggleMany([id], c === true)} />
                            <Favicon url={t.url} favIconUrl={t.favIconUrl} className="mt-0.5" />
                            <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => rpc('openTab', { tabId: id })} title="Switch to this tab">
                              <span className="block truncate text-[13px]">{t.title}</span>
                              <span className="block truncate text-[12px] text-muted-foreground">{reasonLine(v?.reasons)}</span>
                            </button>
                          </li>
                        );
                      })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className={cn('mt-3 flex items-center gap-2', stickyFooter && 'sticky bottom-0 -mx-4 mt-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur')}>
        <Button className="flex-1" size="lg" disabled={busy || (!total && !groupIds.length)} onClick={apply}>
          {applyLabel(closeIds.length, archiveIds.length, groupIds.length)}
        </Button>
      </div>
    </div>
  );
}

function applyLabel(close: number, archive: number, group: number) {
  const n = close + archive;
  if (!n && !group) return 'Pick something to apply';
  if (!n) return `Group ${group} mission${group === 1 ? '' : 's'}`;
  return `Apply plan · ${n} tab${n === 1 ? '' : 's'}${group ? ` + ${group} group${group === 1 ? '' : 's'}` : ''}`;
}

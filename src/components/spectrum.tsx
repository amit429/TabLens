import * as React from 'react';
import { Tooltip } from './ui/tooltip';
import { STATE_META, STATE_ORDER, hostOf } from './tab-bits';
import { cn } from '@/lib/cn';
import type { TabState } from '@/lib/types';

export interface SpectrumItem {
  id: number;
  title: string;
  url?: string;
  state: TabState;
}

/**
 * The signature element: every open tab as one slice, sorted into bands by state —
 * the lens splitting the tab pile into its spectrum.
 */
export function Spectrum({
  items,
  height = 28,
  onSelect,
  highlight,
  className,
  animateKey,
}: {
  items: SpectrumItem[];
  height?: number;
  onSelect?: (id: number) => void;
  highlight?: TabState | null;
  className?: string;
  animateKey?: string;
}) {
  const sorted = React.useMemo(() => [...items].sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)), [items]);
  const gap = sorted.length > 120 ? 0 : 1;
  if (!sorted.length) return <div className={cn('rounded-[6px] bg-muted', className)} style={{ height }} />;
  return (
    <div key={animateKey} role="img" aria-label={spectrumLabel(items)} className={cn('flex w-full items-end overflow-hidden rounded-[6px]', className)} style={{ height, gap }}>
      {sorted.map((t, i) => (
        <Tooltip
          key={t.id}
          delay={60}
          content={
            <span className="block">
              <span className="block font-medium">{t.title}</span>
              <span className="block opacity-70">
                {STATE_META[t.state].label} · {hostOf(t.url)}
              </span>
            </span>
          }
        >
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onSelect?.(t.id)}
            className="h-full min-w-[2px] flex-1 origin-bottom cursor-pointer transition-[opacity,transform] duration-150 hover:scale-y-110 motion-safe:animate-[rise_.5s_cubic-bezier(.2,.8,.2,1)_backwards]"
            style={{
              background: STATE_META[t.state].color,
              opacity: highlight && highlight !== t.state ? 0.18 : 1,
              animationDelay: `${Math.min(i * 6, 500)}ms`,
            }}
          />
        </Tooltip>
      ))}
    </div>
  );
}

export function spectrumLabel(items: SpectrumItem[]) {
  const counts = countStates(items);
  return `${items.length} tabs: ` + STATE_ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${STATE_META[s].label.toLowerCase()}`).join(', ');
}

export function countStates(items: { state: TabState }[]) {
  const c: Partial<Record<TabState, number>> = {};
  for (const i of items) c[i.state] = (c[i.state] ?? 0) + 1;
  return c;
}

export function SpectrumLegend({ items, active, onToggle, className }: { items: SpectrumItem[]; active?: TabState | null; onToggle?: (s: TabState | null) => void; className?: string }) {
  const counts = countStates(items);
  return (
    <div className={cn('flex flex-wrap gap-x-3 gap-y-1', className)}>
      {STATE_ORDER.filter((s) => counts[s]).map((s) => (
        <Tooltip key={s} content={STATE_META[s].hint}>
          <button
            type="button"
            onClick={() => onToggle?.(active === s ? null : s)}
            className={cn('inline-flex items-center gap-1.5 rounded-full text-[12px] text-muted-foreground transition-opacity cursor-pointer hover:text-foreground', active && active !== s && 'opacity-40')}
          >
            <span className="size-2 rounded-full" style={{ background: STATE_META[s].color }} />
            <span className="tabular font-medium text-foreground">{counts[s]}</span> {STATE_META[s].label.toLowerCase()}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

import type { GroupColor } from '@/lib/types';
import * as React from 'react';
import {
  AlertTriangle, BookOpen, Clock, Copy, FileText, Film, FormInput, GitPullRequest, Hand, LayoutGrid, Link2, Mail, Music, Pin, Search, ShieldCheck,
  ShoppingBag, Sparkles, Users, Volume2, Workflow, type LucideIcon,
} from 'lucide-react';
import { faviconFor } from '@/lib/url';
import { cn } from '@/lib/cn';
import type { PageType, Reason, TabState } from '@/lib/types';

export const STATE_ORDER: TabState[] = ['unfinished', 'active', 'simmering', 'no-history', 'protected', 'stale', 'duplicate', 'abandoned'];

export const STATE_META: Record<TabState, { label: string; color: string; hint: string }> = {
  active: { label: 'Active', color: 'var(--state-active)', hint: 'Used in the last day' },
  simmering: { label: 'Simmering', color: 'var(--state-simmering)', hint: 'Used 1–3 days ago, or engaged with' },
  stale: { label: 'Stale', color: 'var(--state-stale)', hint: 'Not opened for 3–7 days, little engagement' },
  abandoned: { label: 'Abandoned', color: 'var(--state-abandoned)', hint: 'Not opened for over a week' },
  unfinished: { label: 'Unfinished', color: 'var(--state-unfinished)', hint: 'Form started or partly read' },
  duplicate: { label: 'Duplicate', color: 'var(--state-duplicate)', hint: 'Same page open in another tab' },
  protected: { label: 'Protected', color: 'var(--state-protected)', hint: 'Pinned, playing audio, or marked Keep' },
  'no-history': { label: 'No history yet', color: 'var(--state-no-history)', hint: 'Open since before TabLens was installed' },
};

export const GROUP_COLOR_VAR: Record<GroupColor, string> = {
  grey: 'var(--g-grey)', blue: 'var(--g-blue)', red: 'var(--g-red)', yellow: 'var(--g-yellow)', green: 'var(--g-green)',
  pink: 'var(--g-pink)', purple: 'var(--g-purple)', cyan: 'var(--g-cyan)', orange: 'var(--g-orange)',
};

export function StateDot({ state, className }: { state: TabState; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: STATE_META[state].color }} />;
}

export function StateChip({ state, className }: { state: TabState; className?: string }) {
  const m = STATE_META[state];
  return (
    <span
      className={cn('inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium whitespace-nowrap', className)}
      style={{ background: `color-mix(in oklab, ${m.color} 14%, transparent)`, color: `color-mix(in oklab, ${m.color} 78%, var(--foreground))` }}
    >
      <StateDot state={state} className="size-1.5" />
      {m.label}
    </span>
  );
}

export function Favicon({ url, favIconUrl, className, size = 16 }: { url?: string; favIconUrl?: string; className?: string; size?: number }) {
  const [failed, setFailed] = React.useState(false);
  const src = url && /^https?:/.test(url) ? faviconFor(url, size * 2) : favIconUrl;
  const letter = (url ? new URL(url, 'https://x').hostname.replace(/^www\./, '')[0] : '?')?.toUpperCase();
  if (!src || failed)
    return (
      <span className={cn('inline-flex shrink-0 items-center justify-center rounded-[4px] bg-muted text-[9px] font-semibold text-muted-foreground', className)} style={{ width: size, height: size }}>
        {letter}
      </span>
    );
  return <img src={src} alt="" width={size} height={size} onError={() => setFailed(true)} className={cn('shrink-0 rounded-[3px]', className)} />;
}

export function ReadDepth({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={`Read ${v}%`}>
      <span className="relative h-1 w-10 overflow-hidden rounded-full bg-muted">
        <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/60" style={{ width: `${v}%` }} />
      </span>
      <span className="tabular text-[11px] text-muted-foreground">{v}%</span>
    </span>
  );
}

const PAGE_ICON: Record<PageType, LucideIcon> = {
  article: BookOpen, product: ShoppingBag, docs: FileText, repo: Workflow, issue: GitPullRequest, video: Film, search: Search, form: FormInput,
  app: LayoutGrid, social: Users, mail: Mail, other: Link2,
};
export function PageTypeIcon({ type, className }: { type: PageType; className?: string }) {
  const I = PAGE_ICON[type] ?? Link2;
  return <I className={cn('size-3.5 text-muted-foreground', className)} aria-hidden />;
}

const REASON_ICON: Record<string, LucideIcon> = {
  pinned: Pin, audible: Volume2, keep: ShieldCheck, form: FormInput, 'partial-read': BookOpen, 'never-auto': Hand, duplicate: Copy,
  idle: Clock, 'no-history': Clock, recent: Clock, engaged: Sparkles, finished: BookOpen, 'low-engagement': AlertTriangle,
  opener: Link2, terms: Sparkles, site: LayoutGrid, repo: Workflow, rule: ShieldCheck, group: LayoutGrid, model: Sparkles, unsorted: Hand, 'user-move': Hand, similar: Sparkles, music: Music,
};

export function ReasonList({ reasons, className }: { reasons: Reason[]; className?: string }) {
  return (
    <ul className={cn('space-y-1.5', className)}>
      {reasons.map((r, i) => {
        const I = REASON_ICON[r.code] ?? Sparkles;
        return (
          <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
            <I className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span>{r.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function reasonLine(reasons: Reason[] | undefined): string {
  return (reasons ?? []).map((r) => r.text).slice(0, 2).join(' · ');
}

export function hostOf(url?: string) {
  try {
    return new URL(url ?? '').hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

import { cn } from '@/lib/cn';

/** The TabLens mark: a lens refracting a tab into a spectrum. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-6', className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--foreground)" />
      <circle cx="13" cy="13" r="6.5" fill="none" stroke="var(--background)" strokeWidth="2.4" />
      <path d="M18 18 L25.5 25.5" stroke="var(--background)" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="6" y="24" width="3" height="3" rx="0.8" fill="var(--state-active)" />
      <rect x="10" y="24" width="3" height="3" rx="0.8" fill="var(--state-simmering)" />
      <rect x="14" y="24" width="3" height="3" rx="0.8" fill="var(--state-stale)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="font-display text-[16px] font-semibold tracking-[-0.01em]">TabLens</span>
    </span>
  );
}

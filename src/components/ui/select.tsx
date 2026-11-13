import { Select as S } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Select<V extends string>({ value, onChange, options, className, ariaLabel }: { value: V; onChange: (v: V) => void; options: { value: V; label: string; note?: string }[]; className?: string; ariaLabel?: string }) {
  return (
    <S.Root value={value} onValueChange={(v) => onChange(v as V)}>
      <S.Trigger aria-label={ariaLabel} className={cn('inline-flex h-8 items-center justify-between gap-2 rounded-[8px] border border-input bg-card px-2.5 text-[13px] cursor-pointer min-w-40', className)}>
        <S.Value />
        <S.Icon>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={6} className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[10px] border border-border bg-popover p-1 shadow-xl">
          <S.Viewport>
            {options.map((o) => (
              <S.Item key={o.value} value={o.value} className="relative flex cursor-pointer select-none flex-col rounded-[6px] py-1.5 pl-7 pr-2 text-[13px] outline-none data-[highlighted]:bg-muted">
                <S.ItemIndicator className="absolute left-2 top-2">
                  <Check className="size-3.5" />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
                {o.note && <span className="text-[11px] text-muted-foreground">{o.note}</span>}
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

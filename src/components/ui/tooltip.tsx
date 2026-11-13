import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cn } from '@/lib/cn';

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children, side = 'top', delay = 250 }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; delay?: number }) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn('z-50 max-w-72 rounded-[8px] bg-primary px-2.5 py-1.5 text-[12px] leading-snug text-primary-foreground shadow-lg')}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

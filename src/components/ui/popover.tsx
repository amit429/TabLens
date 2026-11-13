import * as React from 'react';
import { Popover as P } from 'radix-ui';
import { cn } from '@/lib/cn';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export function PopoverContent({ className, sideOffset = 6, align = 'start', ...props }: React.ComponentPropsWithoutRef<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        sideOffset={sideOffset}
        align={align}
        className={cn('z-50 w-72 rounded-[12px] border border-border bg-popover p-3 shadow-xl data-[state=open]:animate-[pop-in_.12s_ease-out]', className)}
        {...props}
      />
    </P.Portal>
  );
}

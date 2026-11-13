import * as React from 'react';
import { DropdownMenu as M } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuSub = M.Sub;

const panel = 'z-50 min-w-44 overflow-hidden rounded-[10px] border border-border bg-popover p-1 text-[13px] shadow-xl data-[state=open]:animate-[pop-in_.12s_ease-out]';
const item = 'relative flex cursor-pointer select-none items-center gap-2 rounded-[6px] px-2 py-1.5 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:text-muted-foreground';

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentPropsWithoutRef<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content sideOffset={sideOffset} className={cn(panel, className)} {...props} />
    </M.Portal>
  );
}
export function DropdownMenuItem({ className, destructive, ...props }: React.ComponentPropsWithoutRef<typeof M.Item> & { destructive?: boolean }) {
  return <M.Item className={cn(item, destructive && 'text-destructive [&_svg]:text-destructive', className)} {...props} />;
}
export function DropdownMenuCheckboxItem({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof M.CheckboxItem>) {
  return (
    <M.CheckboxItem className={cn(item, 'pl-7', className)} {...props}>
      <M.ItemIndicator className="absolute left-2">
        <Check className="size-3.5" />
      </M.ItemIndicator>
      {children}
    </M.CheckboxItem>
  );
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof M.Label>) {
  return <M.Label className={cn('px-2 py-1 text-[11px] font-medium text-muted-foreground', className)} {...props} />;
}
export function DropdownMenuSeparator() {
  return <M.Separator className="my-1 h-px bg-border" />;
}
export function DropdownMenuSubTrigger({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof M.SubTrigger>) {
  return (
    <M.SubTrigger className={cn(item, 'data-[state=open]:bg-muted', className)} {...props}>
      {children}
      <ChevronRight className="ml-auto size-3.5" />
    </M.SubTrigger>
  );
}
export function DropdownMenuSubContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof M.SubContent>) {
  return (
    <M.Portal>
      <M.SubContent className={cn(panel, 'max-h-80 overflow-y-auto scrollbar-thin', className)} {...props} />
    </M.Portal>
  );
}

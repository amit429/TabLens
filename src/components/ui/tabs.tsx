import * as React from 'react';
import { Tabs as T, ToggleGroup as TG } from 'radix-ui';
import { cn } from '@/lib/cn';

export const Tabs = T.Root;
export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof T.List>) {
  return <T.List className={cn('inline-flex h-8 items-center gap-0.5 rounded-[9px] bg-muted p-0.5', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-2.5 text-[12px] font-medium text-muted-foreground transition-colors data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm cursor-pointer [&_svg]:size-3.5',
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = T.Content;

export function Segmented<V extends string>({ value, onChange, options, className }: { value: V; onChange: (v: V) => void; options: { value: V; label: React.ReactNode }[]; className?: string }) {
  return (
    <TG.Root type="single" value={value} onValueChange={(v) => v && onChange(v as V)} className={cn('inline-flex h-8 items-center gap-0.5 rounded-[9px] bg-muted p-0.5', className)}>
      {options.map((o) => (
        <TG.Item
          key={o.value}
          value={o.value}
          className="inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] font-medium text-muted-foreground transition-colors data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm cursor-pointer [&_svg]:size-3.5"
        >
          {o.label}
        </TG.Item>
      ))}
    </TG.Root>
  );
}

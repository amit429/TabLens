import * as React from 'react';
import { AlarmClock } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from './ui/dropdown-menu';
import { act, snoozeTimes } from '@/lib/ui-actions';
import { rpc } from '@/lib/rpc';

export function SnoozeMenu({ tabIds, children, onDone }: { tabIds: number[]; children: React.ReactNode; onDone?: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Close now, reopen…</DropdownMenuLabel>
        {snoozeTimes().map((o) => (
          <DropdownMenuItem
            key={o.label}
            onSelect={async () => {
              await act(rpc('snoozeTabs', { tabIds, until: o.at }));
              onDone?.();
            }}
          >
            <AlarmClock />
            <span className="flex-1">{o.label}</span>
            <span className="text-[11px] text-muted-foreground">{new Date(o.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

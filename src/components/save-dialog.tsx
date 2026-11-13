import * as React from 'react';
import { BookOpen, Film, Lightbulb, ListTodo, Library, ShoppingBag, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Label, Textarea } from './ui/input';
import { Favicon, hostOf } from './tab-bits';
import { INTENTS } from '@/lib/library';
import { rpc } from '@/lib/rpc';
import { act, snoozeTimes } from '@/lib/ui-actions';
import { cn } from '@/lib/cn';
import type { SaveIntent } from '@/lib/types';

export const INTENT_ICON: Record<SaveIntent, LucideIcon> = {
  read: BookOpen,
  buy: ShoppingBag,
  reference: Library,
  watch: Film,
  todo: ListTodo,
  inspiration: Lightbulb,
};

export interface SavePage {
  url: string;
  title: string;
  favIconUrl?: string;
  tabId?: number;
}

export function SaveForm({ page, onDone, compact }: { page: SavePage; onDone?: () => void; compact?: boolean }) {
  const [intent, setIntent] = React.useState<SaveIntent>('read');
  const [note, setNote] = React.useState('');
  const [remind, setRemind] = React.useState<number | undefined>();
  const [closeTab, setCloseTab] = React.useState(page.tabId !== undefined);
  const times = React.useMemo(() => snoozeTimes().filter((t) => t.label !== 'In 3 hours'), []);

  const submit = async () => {
    await act(
      rpc('saveForLater', { url: page.url, title: page.title, favIconUrl: page.favIconUrl, intent, note: note.trim(), remindAt: remind, closeTabId: closeTab ? page.tabId : undefined }).then(() => ({
        count: 1,
        message: closeTab ? 'Saved to your library and closed the tab' : 'Saved to your library',
      })),
    );
    onDone?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 rounded-[10px] border border-border bg-muted/40 p-2.5">
        <Favicon url={page.url} favIconUrl={page.favIconUrl} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{page.title}</div>
          <div className="truncate text-[12px] text-muted-foreground">{hostOf(page.url)}</div>
        </div>
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Why are you saving it?</legend>
        <div className={cn('grid gap-1.5', compact ? 'grid-cols-2' : 'grid-cols-3')}>
          {INTENTS.map((i) => {
            const I = INTENT_ICON[i.id];
            return (
              <button
                key={i.id}
                type="button"
                aria-pressed={intent === i.id}
                onClick={() => setIntent(i.id)}
                title={i.hint}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-[8px] border px-2.5 text-[12px] font-medium transition-colors cursor-pointer',
                  intent === i.id ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted',
                )}
              >
                <I className="size-3.5" />
                {i.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="save-note">Note for future you</Label>
        <Textarea id="save-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Compare battery life with the ThinkPad before Friday" />
      </div>
      <div className="space-y-1.5">
        <div className="text-[13px] font-medium">Remind me</div>
        <div className="flex flex-wrap gap-1.5">
          {[{ label: 'No reminder', at: undefined as number | undefined }, ...times].map((t) => (
            <button
              key={t.label}
              type="button"
              aria-pressed={remind === t.at}
              onClick={() => setRemind(t.at)}
              className={cn('h-7 rounded-full border px-2.5 text-[12px] cursor-pointer', remind === t.at ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {page.tabId !== undefined && (
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={closeTab} onCheckedChange={(c) => setCloseTab(c === true)} />
          Close the tab after saving
        </label>
      )}
      <Button className="w-full" onClick={submit}>
        Save to library
      </Button>
    </div>
  );
}

export function SaveDialog({ open, onOpenChange, page }: { open: boolean; onOpenChange: (o: boolean) => void; page: SavePage }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Save for later</DialogTitle>
        <DialogDescription>Saved pages go to your Library with the reason you saved them.</DialogDescription>
        <div className="mt-4">
          <SaveForm page={page} onDone={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

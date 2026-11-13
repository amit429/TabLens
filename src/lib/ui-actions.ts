import { toast } from 'sonner';
import { rpc, type UndoResult } from './rpc';

/** Runs an action and shows its result with a 30-second Undo. */
export async function act(run: Promise<UndoResult | void>, opts: { success?: string } = {}): Promise<UndoResult | void> {
  try {
    const r = await run;
    const message = (r && r.message) || opts.success;
    if (message)
      toast(message, {
        duration: 30_000,
        action: r && r.undoId ? { label: 'Undo', onClick: () => undoNow(r.undoId!) } : undefined,
      });
    return r;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err));
  }
}

async function undoNow(undoId: string) {
  const r = await rpc('undo', { undoId });
  if (r.ok) toast('Undone');
  else toast.error('That action can no longer be undone. Restore it from the Archive.');
}

export function snoozeTimes(now = new Date()) {
  const at = (d: Date, h: number) => {
    const x = new Date(d);
    x.setHours(h, 0, 0, 0);
    return x.getTime();
  };
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const weekend = new Date(now);
  weekend.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const opts = [
    { label: 'In 3 hours', at: now.getTime() + 3 * 3_600_000 },
    { label: 'This evening', at: at(now, 19) },
    { label: 'Tomorrow morning', at: at(tomorrow, 9) },
    { label: 'This weekend', at: at(weekend, 10) },
    { label: 'Next week', at: at(nextWeek, 9) },
    { label: 'In a month', at: now.getTime() + 30 * 86_400_000 },
  ];
  return opts.filter((o) => o.at > now.getTime() + 30 * 60_000);
}

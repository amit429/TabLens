import * as React from 'react';
import { ArrowRight, Check, Eye, Loader2, Lock, Puzzle, Sparkles } from 'lucide-react';
import { useDashboard } from '../App';
import { Wordmark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Spectrum, SpectrumLegend } from '@/components/spectrum';
import { GROUP_COLOR_VAR } from '@/components/tab-bits';
import { requestAccess, usePageAccess } from '@/hooks/access';
import { updateSettings } from '@/lib/settings';
import { rpc } from '@/lib/rpc';
import { act } from '@/lib/ui-actions';
import { cn } from '@/lib/cn';

const STEPS = ['Your tabs', 'Page reading', 'Your missions'];

export default function Welcome() {
  const { analysis, tabs, navigate, live } = useDashboard();
  const [step, setStep] = React.useState(0);
  const [useAi, setUseAi] = React.useState(true);
  const [organizing, setOrganizing] = React.useState(false);
  const access = usePageAccess();
  const items = tabs.map((t) => ({ id: t.id!, title: t.title ?? '', url: t.url, state: analysis?.verdicts[t.id!]?.state ?? 'no-history' }));
  const missions = live.missions.filter((m) => m.id !== 'unsorted' && m.live.length);
  const windows = new Set(tabs.map((t) => t.windowId)).size;

  const organize = async () => {
    setOrganizing(true);
    try {
      await rpc('analyze', { fresh: true });
    } catch {
      /* the heuristic result stays; Settings → AI shows what went wrong */
    } finally {
      setOrganizing(false);
    }
  };

  const next = async () => {
    if (step === 0) {
      await updateSettings({ ai: { cloudConsent: useAi } });
      // Organise right away so the missions on the last step are Gemini's, not the heuristic draft.
      organize();
    }
    setStep(step + 1);
  };

  const finish = async () => {
    await updateSettings({ onboarded: true });
    navigate('missions');
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-2xl flex-col px-6 py-10">
        <Wordmark />
        <ol className="mt-10 flex gap-2" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1">
              <div className={cn('h-1 rounded-full', i <= step ? 'bg-foreground' : 'bg-muted')} />
              <div className={cn('mt-2 text-[12px]', i === step ? 'font-medium' : 'text-muted-foreground')}>
                {i + 1}. {s}
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-10 min-h-[380px]">
          {step === 0 && (
            <section>
              <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.02em]">
                You have {tabs.length} tabs open across {windows} window{windows === 1 ? '' : 's'}.
              </h1>
              <p className="mt-3 text-[15px] text-muted-foreground">
                Here they are, one slice each. TabLens will sort them into missions — the tasks they belong to — and turn those into real Chrome tab groups when you say so.
              </p>
              <Spectrum items={items} height={56} className="mt-8 rounded-[10px]" animateKey={String(tabs.length)} />
              <SpectrumLegend items={items} className="mt-3" />

              <label className={cn('mt-8 flex cursor-pointer items-start gap-4 rounded-[14px] border bg-card p-4', useAi ? 'border-foreground' : 'border-border')}>
                <Sparkles className="mt-0.5 size-5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Organise my tabs with Gemini</span>
                  <span className="mt-1 block text-[13px] text-muted-foreground">
                    Gemini reads a short description of each tab — title, site, page type and up to 100 words of summary — and decides the missions. No API key, nothing stored, never full pages, form data or your history. Turn it off any time in Settings.
                  </span>
                </span>
                <Switch checked={useAi} onCheckedChange={setUseAi} aria-label="Organise my tabs with Gemini" />
              </label>
              <p className="mt-4 flex items-start gap-2 text-[13px] text-muted-foreground">
                <Lock className="mt-0.5 size-4 shrink-0" /> Tabs open before today are labelled “No history yet” instead of being guessed as stale. Nothing is closed or grouped without your click.
              </p>
            </section>
          )}

          {step === 1 && (
            <section>
              <h1 className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.02em]">Let TabLens read what's on each page</h1>
              <p className="mt-3 text-[15px] text-muted-foreground">
                With page reading, TabLens can tell a laptop review from a laptop job listing on the same site, and remember how far you read each article. Without it, missions are judged from titles and URLs.
              </p>
              <ul className="mt-6 space-y-2.5 text-[14px]">
                {[
                  'Reads up to 2,000 words of main text and the headings, once per page load',
                  'Counts clicks and keypresses — never what you type',
                  'Notes that a form was started — never its values',
                  'Skips banking, payment, health and password sites, and any site you add',
                  'Stores everything in this browser only',
                ].map((x) => (
                  <li key={x} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-active" /> {x}
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                {access ? (
                  <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-[13px] font-medium">
                    <Check className="size-4 text-active" /> Page reading is on
                  </div>
                ) : (
                  <Button size="lg" variant="accent" onClick={requestAccess}>
                    <Eye /> Allow page reading
                  </Button>
                )}
                <p className="mt-2 text-[12px] text-muted-foreground">Chrome will ask to “read and change data on all websites”. TabLens only reads; you can turn it off in Settings.</p>
              </div>
            </section>
          )}

          {step === 2 && (
            <section>
              <h1 className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.02em]">
                {organizing ? 'Gemini is organising your tabs…' : `${missions.length} mission${missions.length === 1 ? '' : 's'} found.`}
              </h1>
              <p className="mt-3 text-[15px] text-muted-foreground">
                {organizing
                  ? 'This takes a few seconds. You can carry on — the result appears here and on the board.'
                  : analysis?.engine === 'cloud'
                    ? 'Organised by Gemini. Turn them into real Chrome tab groups — across all your windows — with one click, or adjust them on the board first.'
                    : 'Sorted by on-device heuristics. Turn them into real Chrome tab groups with one click, or adjust them on the board first.'}
              </p>
              <ul className="mt-6 space-y-2">
                {organizing && !missions.length && <li className="h-24 animate-pulse rounded-[12px] bg-muted" />}
                {missions.slice(0, 7).map((m) => (
                  <li key={m.id} className="flex items-center gap-3 rounded-[12px] border border-border bg-card px-4 py-3">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: GROUP_COLOR_VAR[m.color] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{m.name}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{m.intent}</span>
                    </span>
                    <span className="tabular text-[12px] text-muted-foreground">{m.live.length} tabs</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 flex items-start gap-2 text-[13px] text-muted-foreground">
                <Puzzle className="mt-0.5 size-4 shrink-0" /> Pin TabLens from the puzzle-piece menu so the badge shows how many tabs can go. Shortcuts: popup Alt+Shift+L, side panel Alt+Shift+S, dashboard Alt+Shift+D.
              </p>
            </section>
          )}
        </div>

        <div className="mt-8 flex items-center gap-2 border-t border-border pt-5">
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {step === 1 && !access && (
              <Button variant="ghost" onClick={() => setStep(2)}>
                Not now
              </Button>
            )}
            {step < 2 && (
              <Button onClick={next}>
                Continue <ArrowRight />
              </Button>
            )}
            {step === 2 && (
              <>
                <Button variant="outline" onClick={finish} disabled={organizing}>
                  Review on the board
                </Button>
                <Button
                  size="lg"
                  disabled={organizing || !missions.length}
                  onClick={async () => {
                    await act(rpc('groupMissions', { missionIds: missions.filter((m) => m.live.length > 1).map((m) => m.id) }));
                    await finish();
                  }}
                >
                  {organizing ? <Loader2 className="animate-spin" /> : null}
                  Group them in Chrome <ArrowRight />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

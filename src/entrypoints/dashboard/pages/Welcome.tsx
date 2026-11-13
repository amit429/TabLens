import * as React from 'react';
import { ArrowRight, Check, Cpu, Eye, KeyRound, Lock, Puzzle } from 'lucide-react';
import { useDashboard } from '../App';
import { Wordmark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spectrum, SpectrumLegend } from '@/components/spectrum';
import { requestAccess, usePageAccess } from '@/hooks/access';
import { updateSettings } from '@/lib/settings';
import { rpc } from '@/lib/rpc';
import { cn } from '@/lib/cn';
import type { NanoStatus } from '@/lib/ai/router';

const STEPS = ['Your tabs', 'Page reading', 'AI naming', 'Ready'];

export default function Welcome() {
  const { analysis, tabs, navigate, live } = useDashboard();
  const [step, setStep] = React.useState(0);
  const access = usePageAccess();
  const [nano, setNano] = React.useState<NanoStatus | null>(null);
  const [key, setKey] = React.useState('');
  React.useEffect(() => {
    rpc('aiStatus', {}).then((r) => setNano(r.nano)).catch(() => setNano('unsupported'));
  }, []);
  const items = tabs.map((t) => ({ id: t.id!, title: t.title ?? '', url: t.url, state: analysis?.verdicts[t.id!]?.state ?? 'no-history' }));
  const missions = live.missions.filter((m) => m.id !== 'unsorted' && m.live.length).length;
  const windows = new Set(tabs.map((t) => t.windowId)).size;

  const finish = async () => {
    await updateSettings({ onboarded: true });
    rpc('analyze', { fresh: true }).catch(() => {});
    navigate('overview');
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

        <div className="mt-10 min-h-[340px]">
          {step === 0 && (
            <section>
              <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.02em]">
                You have {tabs.length} tabs open across {windows} window{windows === 1 ? '' : 's'}.
              </h1>
              <p className="mt-3 text-[15px] text-muted-foreground">
                Here they are, one slice each. TabLens already sorted them into {missions || 'a few'} missions from their titles. From now on it also notices how you use each one, so it can tell you what's safe to let go.
              </p>
              <Spectrum items={items} height={56} className="mt-8 rounded-[10px]" animateKey={String(tabs.length)} />
              <SpectrumLegend items={items} className="mt-3" />
              <p className="mt-6 flex items-start gap-2 text-[13px] text-muted-foreground">
                <Lock className="mt-0.5 size-4 shrink-0" /> Tabs that were open before today are labelled “No history yet” instead of being guessed as stale. Nothing is closed or grouped without your click.
              </p>
            </section>
          )}

          {step === 1 && (
            <section>
              <h1 className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.02em]">Let TabLens read what's on each page</h1>
              <p className="mt-3 text-[15px] text-muted-foreground">
                With page reading, TabLens can tell a laptop review from a laptop job listing on the same site, and remember how far you read each article. Without it, it groups by titles and URLs.
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
              <h1 className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.02em]">Name missions with Gemini</h1>
              <p className="mt-3 text-[15px] text-muted-foreground">
                Grouping works without AI. Gemini turns “Laptop & Battery” into “Comparing laptops under ₹80k”, and summarises pages when you ask.
              </p>
              <div className="mt-6 space-y-3">
                <div className="rounded-[14px] border border-border bg-card p-4">
                  <div className="flex items-center gap-2 font-medium">
                    <Cpu className="size-4" /> Gemini Nano, on this device
                    {nano === 'available' && <span className="ml-auto text-[12px] text-active">Ready — used automatically</span>}
                  </div>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {nano === 'available'
                      ? 'Private and free: tab data never leaves your computer.'
                      : nano === 'downloadable' || nano === 'downloading'
                        ? 'Supported here. Download it later from Settings → AI (about 2–4 GB).'
                        : 'Not available on this device or browser.'}
                  </p>
                </div>
                <div className="rounded-[14px] border border-border bg-card p-4">
                  <div className="flex items-center gap-2 font-medium">
                    <KeyRound className="size-4" /> Gemini API, with your key
                  </div>
                  <p className="mt-1 text-[13px] text-muted-foreground">Sends only a short descriptor per tab (title, site, type, ≤100-word summary). Get a key in Google AI Studio.</p>
                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!key.trim()) return;
                      await updateSettings({ ai: { apiKey: key.trim(), cloudConsent: true } });
                      setStep(3);
                    }}
                  >
                    <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your Gemini API key" className="font-mono text-[12px]" autoComplete="off" />
                    <Button type="submit" disabled={!key.trim()}>
                      Use Gemini
                    </Button>
                  </form>
                </div>
              </div>
            </section>
          )}

          {step === 3 && (
            <section>
              <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.02em]">You're set.</h1>
              <p className="mt-3 text-[15px] text-muted-foreground">Three places to find TabLens:</p>
              <ul className="mt-6 space-y-4 text-[14px]">
                <li className="flex gap-3">
                  <Puzzle className="mt-0.5 size-5 shrink-0" />
                  <span>
                    <strong>Toolbar popup</strong> — the verdict and the cleanup plan. Pin TabLens from the puzzle-piece menu so the badge shows how many tabs can go. <span className="text-muted-foreground">Alt+Shift+L</span>
                  </span>
                </li>
                <li className="flex gap-3">
                  <Eye className="mt-0.5 size-5 shrink-0" />
                  <span>
                    <strong>Side panel</strong> — what the current tab is and why it's in its mission, plus quick save. <span className="text-muted-foreground">Alt+Shift+S</span>
                  </span>
                </li>
                <li className="flex gap-3">
                  <ArrowRight className="mt-0.5 size-5 shrink-0" />
                  <span>
                    <strong>Dashboard</strong> — the missions board with drag and drop, your library and the archive. <span className="text-muted-foreground">Alt+Shift+D</span>
                  </span>
                </li>
              </ul>
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
            {step === 2 && (
              <Button variant="ghost" onClick={() => setStep(3)}>
                Skip
              </Button>
            )}
            {step < 3 && step !== 2 && (
              <Button onClick={() => setStep(step + 1)}>
                Continue <ArrowRight />
              </Button>
            )}
            {step === 3 && (
              <Button size="lg" onClick={finish}>
                Open my dashboard <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

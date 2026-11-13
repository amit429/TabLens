import * as React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Cpu, Download, Eye, EyeOff, KeyRound, Loader2, Pause, Play, Plus, ShieldAlert, Trash2, Upload, X, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Kbd, Label } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Segmented } from '@/components/ui/tabs';
import { Select } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { usePageAccess, requestAccess } from '@/hooks/access';
import { useSettings } from '@/hooks/data';
import { DEFAULT_SETTINGS, SENSITIVE_PRESETS, isPaused, updateSettings, type AiMode, type Settings as S } from '@/lib/settings';
import { GEMINI_MODELS, downloadNano, type NanoStatus } from '@/lib/ai/router';
import { buildUserPrompt } from '@/lib/ai/prompt';
import { db, uid } from '@/lib/db';
import { rpc } from '@/lib/rpc';
import { WEB_ORIGINS, hostnameOf } from '@/lib/url';
import { cn } from '@/lib/cn';

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'ai', label: 'AI' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'rules', label: 'Learned rules' },
  { id: 'data', label: 'Your data' },
];

export default function Settings() {
  const s = useSettings();
  const [active, setActive] = React.useState('general');

  React.useEffect(() => {
    const obs = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: '-30% 0px -60% 0px' });
    SECTIONS.forEach((x) => {
      const el = document.getElementById(x.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  return (
    <div className="mx-auto flex max-w-5xl gap-10">
      <nav className="sticky top-20 hidden h-fit w-40 shrink-0 space-y-0.5 lg:block" aria-label="Settings sections">
        {SECTIONS.map((x) => (
          <a
            key={x.id}
            href={`#/settings`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(x.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className={cn('block rounded-[8px] px-2.5 py-1.5 text-[13px]', active === x.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {x.label}
          </a>
        ))}
      </nav>
      <div className="min-w-0 flex-1 space-y-12 pb-24">
        <General s={s} />
        <Analysis s={s} />
        <Ai s={s} />
        <Privacy s={s} />
        <Rules />
        <Data />
      </div>
    </div>
  );
}

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="font-display text-[20px] font-semibold tracking-[-0.01em]">{title}</h2>
      {hint && <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{hint}</p>}
      <div className="mt-4 divide-y divide-border rounded-[14px] border border-border bg-card">{children}</div>
    </section>
  );
}

function Row({ label, hint, children, wide }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('flex gap-4 px-5 py-4', wide ? 'flex-col' : 'flex-col sm:flex-row sm:items-center')}>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[13px] text-muted-foreground">{hint}</div>}
      </div>
      <div className={cn(wide ? 'w-full' : 'shrink-0')}>{children}</div>
    </div>
  );
}

function General({ s }: { s: S }) {
  return (
    <Section id="general" title="General">
      <Row label="Theme">
        <Segmented
          value={s.theme}
          onChange={(theme) => updateSettings({ theme })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Row>
      <Row label="“Already open” nudge" hint="When you open a page that's already open in another tab, offer to switch to it.">
        <Switch checked={s.features.alreadyOpenNudge} onCheckedChange={(v) => updateSettings({ features: { alreadyOpenNudge: v } })} />
      </Row>
      <Row label="Toolbar badge" hint="Show how many tabs can go on the TabLens icon.">
        <Switch
          checked={s.features.badge}
          onCheckedChange={async (v) => {
            await updateSettings({ features: { badge: v } });
            rpc('analyze', {}).catch(() => {});
          }}
        />
      </Row>
      <Row label="Daily analysis" hint="Re-analyse once a day at 9:00, including AI mission names.">
        <Switch checked={s.features.dailyAnalysis} onCheckedChange={(v) => updateSettings({ features: { dailyAnalysis: v } })} />
      </Row>
      <Row label="Weekly digest" hint="A notification once a week when tabs have gone untouched for a week or more.">
        <Switch checked={s.features.weeklyDigest} onCheckedChange={(v) => updateSettings({ features: { weeklyDigest: v } })} />
      </Row>
      <Row
        label="Keyboard shortcuts"
        hint={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            Popup <Kbd>Alt</Kbd>
            <Kbd>Shift</Kbd>
            <Kbd>L</Kbd> · Dashboard <Kbd>Alt</Kbd>
            <Kbd>Shift</Kbd>
            <Kbd>D</Kbd> · Side panel <Kbd>Alt</Kbd>
            <Kbd>Shift</Kbd>
            <Kbd>S</Kbd> · Find <Kbd>⌘K</Kbd>
          </span>
        }
      >
        <Button variant="outline" onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
          Change shortcuts
        </Button>
      </Row>
    </Section>
  );
}

function Analysis({ s }: { s: S }) {
  const t = s.thresholds;
  const w = s.weights;
  const total = w.active + w.scroll + w.visits + w.interactions || 1;
  const commit = async (patch: Parameters<typeof updateSettings>[0]) => {
    await updateSettings(patch);
    rpc('analyze', {}).catch(() => {});
  };
  return (
    <Section id="analysis" title="Analysis" hint="How TabLens decides a tab's state. Changes apply on the next analysis, which runs as soon as you let go of a slider.">
      <Row label="Simmering after" hint="A tab stops being active after this long without a visit." wide>
        <SliderField value={t.simmeringDays} min={0.25} max={3} step={0.25} unit="days" onCommit={(v) => commit({ thresholds: { simmeringDays: v } })} />
      </Row>
      <Row label="Stale after" hint="Tabs this old with little engagement are suggested for archiving (unchecked by default)." wide>
        <SliderField value={t.staleDays} min={1} max={14} step={1} unit="days" onCommit={(v) => commit({ thresholds: { staleDays: v } })} />
      </Row>
      <Row label="Abandoned after" hint="Tabs this old are pre-checked in the cleanup plan." wide>
        <SliderField value={t.abandonedDays} min={3} max={45} step={1} unit="days" onCommit={(v) => commit({ thresholds: { abandonedDays: v } })} />
      </Row>
      <Row label="Unfinished reading range" hint="Articles read within this range are protected as unfinished." wide>
        <RangeField value={[t.unfinishedMin, t.unfinishedMax]} onCommit={([a, b]) => commit({ thresholds: { unfinishedMin: a, unfinishedMax: b } })} />
      </Row>
      <Row label="Engagement weights" hint="How much each signal counts toward a tab's engagement score." wide>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['active', 'Active time'],
              ['scroll', 'Read depth'],
              ['visits', 'Visits'],
              ['interactions', 'Clicks and keys'],
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <div className="mb-1 flex justify-between text-[12px]">
                <span>{label}</span>
                <span className="tabular text-muted-foreground">{Math.round((w[k] / total) * 100)}%</span>
              </div>
              <SliderBare value={w[k]} min={0} max={1} step={0.05} onCommit={(v) => commit({ weights: { [k]: v } })} />
            </div>
          ))}
        </div>
        <Button variant="link" className="mt-3" onClick={() => commit({ weights: DEFAULT_SETTINGS.weights })}>
          Reset to defaults
        </Button>
      </Row>
      <Row label="Mission size" hint="Broader puts more tabs together; tighter makes smaller, more specific missions." wide>
        <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
          Broader
          <SliderBare value={s.similarity} min={0.1} max={0.45} step={0.01} onCommit={(v) => commit({ similarity: v })} />
          Tighter
        </div>
      </Row>
      <Row label="Unsorted threshold" hint="Groups less coherent than this land in Unsorted instead of a guessed mission." wide>
        <SliderField value={Math.round(s.confidenceThreshold * 100)} min={10} max={80} step={5} unit="% confidence" onCommit={(v) => commit({ confidenceThreshold: v / 100 })} />
      </Row>
    </Section>
  );
}

function SliderField({ value, min, max, step, unit, onCommit }: { value: number; min: number; max: number; step: number; unit: string; onCommit: (v: number) => void }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  return (
    <div className="flex items-center gap-4">
      <Slider value={[v]} min={min} max={max} step={step} onValueChange={([x]) => setV(x!)} onValueCommit={([x]) => onCommit(x!)} />
      <span className="tabular w-28 shrink-0 text-right text-[13px]">
        {v} {v === 1 ? unit.replace(/s$/, '') : unit}
      </span>
    </div>
  );
}

function SliderBare({ value, min, max, step, onCommit }: { value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  return <Slider value={[v]} min={min} max={max} step={step} onValueChange={([x]) => setV(x!)} onValueCommit={([x]) => onCommit(x!)} />;
}

function RangeField({ value, onCommit }: { value: [number, number]; onCommit: (v: [number, number]) => void }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value[0], value[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex items-center gap-4">
      <Slider value={v} min={0} max={100} step={5} minStepsBetweenThumbs={2} onValueChange={(x) => setV([x[0]!, x[1]!])} onValueCommit={(x) => onCommit([x[0]!, x[1]!])} />
      <span className="tabular w-28 shrink-0 text-right text-[13px]">
        {v[0]}–{v[1]}% read
      </span>
    </div>
  );
}

function Ai({ s }: { s: S }) {
  const [nano, setNano] = React.useState<NanoStatus | null>(null);
  const [downloading, setDownloading] = React.useState<number | null>(null);
  const [showKey, setShowKey] = React.useState(false);
  const [key, setKey] = React.useState(s.ai.apiKey);
  const [test, setTest] = React.useState<{ ok: boolean; message: string } | 'running' | null>(null);
  const [sample, setSample] = React.useState('');
  React.useEffect(() => setKey(s.ai.apiKey), [s.ai.apiKey]);
  React.useEffect(() => {
    rpc('aiStatus', {}).then((r) => setNano(r.nano)).catch(() => setNano('unsupported'));
    chrome.tabs.query({ active: true, lastFocusedWindow: false }).then(async (tabs) => {
      const t = tabs.find((x) => /^https?:/.test(x.url ?? ''));
      if (!t) return;
      const snap = await db.snapshots.where('normUrl').startsWith((t.url ?? '').replace(/^https?:\/\/(www\.)?/, 'https://').split('#')[0]!.split('?')[0]!).first();
      setSample(
        buildUserPrompt([], [{ id: t.id!, title: t.title ?? '', site: hostnameOf(t.url ?? ''), pageType: snap?.pageType ?? 'other', summary: (snap?.description || snap?.text || '').slice(0, 600) }]),
      );
    });
  }, []);

  const NANO_TEXT: Record<NanoStatus, [string, string]> = {
    available: ['Ready', 'Gemini Nano is on this device. Mission names are generated locally; nothing leaves your computer.'],
    downloadable: ['Not downloaded', 'Chrome can download Gemini Nano (about 2–4 GB). It needs 22 GB free disk space and 16 GB RAM or a GPU with 4 GB+ VRAM.'],
    downloading: ['Downloading', 'Chrome is downloading Gemini Nano in the background.'],
    unavailable: ['Not available on this device', 'This computer doesn’t meet Gemini Nano’s hardware needs. Use the Gemini API instead, or keep heuristic names.'],
    unsupported: ['Not supported in this browser', 'This browser has no built-in Prompt API. Use the Gemini API instead, or keep heuristic names.'],
  };

  return (
    <Section id="ai" title="AI" hint="TabLens groups tabs without AI. Gemini only names missions, writes their one-line intent and summarises pages in the dossier.">
      <Row label="Mode" hint="Automatic uses Gemini Nano on this device when it's available, otherwise the Gemini API if you've turned it on.">
        <Segmented<AiMode>
          value={s.ai.mode}
          onChange={(mode) => updateSettings({ ai: { mode } })}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'nano', label: 'On device' },
            { value: 'cloud', label: 'Gemini API' },
            { value: 'off', label: 'Off' },
          ]}
        />
      </Row>
      <Row
        label={
          <span className="inline-flex items-center gap-2">
            <Cpu className="size-4" /> Gemini Nano (on device)
            {nano && <Badge variant={nano === 'available' ? 'accent' : 'default'}>{NANO_TEXT[nano][0]}</Badge>}
          </span>
        }
        hint={nano ? NANO_TEXT[nano][1] : 'Checking…'}
      >
        {nano === 'downloadable' && (
          <Button
            variant="outline"
            disabled={downloading !== null}
            onClick={async () => {
              setDownloading(0);
              try {
                await downloadNano((p) => setDownloading(p));
                setNano('available');
                toast('Gemini Nano is ready');
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e));
              } finally {
                setDownloading(null);
              }
            }}
          >
            {downloading !== null ? <Loader2 className="animate-spin" /> : <Download />}
            {downloading !== null ? `Downloading ${Math.round(downloading * 100)}%` : 'Download model'}
          </Button>
        )}
      </Row>
      <Row label="Use the Gemini API" hint="Sends a short descriptor per tab (title, site, page type, ≤100-word summary) to Google's Gemini API with your own key. Never full page text, never form data.">
        <Switch checked={s.ai.cloudConsent} onCheckedChange={(v) => updateSettings({ ai: { cloudConsent: v } })} />
      </Row>
      {s.ai.cloudConsent && (
        <>
          <Row label="Gemini API key" hint="Stored only in this browser's extension storage. Get one in Google AI Studio." wide>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                await updateSettings({ ai: { apiKey: key.trim() } });
                toast('API key saved');
              }}
            >
              <div className="relative min-w-64 flex-1">
                <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input type={showKey ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza…" className="pl-8 pr-9 font-mono text-[12px]" autoComplete="off" spellCheck={false} />
                <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground" aria-label={showKey ? 'Hide key' : 'Show key'}>
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <Button type="submit" variant="outline" disabled={key.trim() === s.ai.apiKey}>
                Save key
              </Button>
            </form>
          </Row>
          <Row label="Model">
            <Select value={s.ai.model} onChange={(model) => updateSettings({ ai: { model } })} options={GEMINI_MODELS.map((m) => ({ value: m.id, label: m.label, note: m.note }))} ariaLabel="Gemini model" className="min-w-56" />
          </Row>
          <Row label="Test connection" hint={test && test !== 'running' ? <span className={cn('inline-flex items-center gap-1', test.ok ? 'text-active' : 'text-destructive')}>{test.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}{test.message}</span> : 'Sends one tiny request to check the key and model.'}>
            <Button
              variant="outline"
              disabled={!s.ai.apiKey || test === 'running'}
              onClick={async () => {
                setTest('running');
                setTest(await rpc('testCloud', {}).catch((e) => ({ ok: false, message: String(e) })));
              }}
            >
              {test === 'running' && <Loader2 className="animate-spin" />} Test
            </Button>
          </Row>
          {sample && (
            <Row label="Exactly what's sent for one tab" hint="This is the line Gemini sees for the tab you were last on." wide>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-[10px] bg-muted p-3 text-[12px] leading-relaxed scrollbar-thin">{sample}</pre>
            </Row>
          )}
        </>
      )}
    </Section>
  );
}

function Privacy({ s }: { s: S }) {
  const access = usePageAccess();
  const [domain, setDomain] = React.useState('');
  const paused = isPaused(s);
  const excluded = s.privacy.excludedDomains;
  const setExcluded = (list: string[]) => updateSettings({ privacy: { excludedDomains: [...new Set(list)] } });
  const add = () => {
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (!d) return;
    setExcluded([...excluded, d]);
    setDomain('');
  };
  return (
    <Section id="privacy" title="Privacy" hint="Everything TabLens records stays in this browser. Form values, passwords and what you type are never captured — only counts and a form-started flag.">
      <Row label="Page reading" hint={access ? 'On. TabLens reads page text (up to 2,000 words) to understand each tab.' : 'Off. Missions use titles and URLs only.'}>
        {access ? (
          <Button
            variant="outline"
            onClick={async () => {
              await chrome.permissions.remove({ origins: WEB_ORIGINS });
              toast('Page reading turned off');
            }}
          >
            Turn off
          </Button>
        ) : (
          <Button variant="accent" onClick={requestAccess}>
            Allow page reading
          </Button>
        )}
      </Row>
      <Row label="Never read these sites" hint="Excluded sites are never read or summarised, even with page reading on. Subdomains are included." wide>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {Object.entries(SENSITIVE_PRESETS).map(([name, list]) => {
            const on = list.every((d) => excluded.includes(d));
            return (
              <button
                key={name}
                aria-pressed={on}
                onClick={() => setExcluded(on ? excluded.filter((d) => !list.includes(d)) : [...excluded, ...list])}
                className={cn('inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12px]', on ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted')}
              >
                <ShieldAlert className="size-3" /> {name}
              </button>
            );
          })}
        </div>
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Add a site, e.g. mybank.com" className="max-w-xs" />
          <Button type="submit" variant="outline" disabled={!domain.trim()}>
            <Plus /> Add
          </Button>
        </form>
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto scrollbar-thin">
          {excluded.map((d) => (
            <span key={d} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted pl-2.5 pr-1 text-[12px]">
              {d}
              <button onClick={() => setExcluded(excluded.filter((x) => x !== d))} className="cursor-pointer rounded-full p-0.5 hover:bg-input" aria-label={`Remove ${d}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      </Row>
      <Row label="Track incognito tabs" hint="Off by default. Also requires “Allow in Incognito” on the extensions page.">
        <Switch checked={s.privacy.trackIncognito} onCheckedChange={(v) => updateSettings({ privacy: { trackIncognito: v } })} />
      </Row>
      <Row label="Pause tracking" hint={paused ? (s.privacy.pausedUntil === -1 ? 'Paused until you resume.' : `Paused until ${new Date(s.privacy.pausedUntil).toLocaleString()}.`) : 'TabLens records nothing while paused.'}>
        {paused ? (
          <Button variant="outline" onClick={() => updateSettings({ privacy: { pausedUntil: 0 } })}>
            <Play /> Resume
          </Button>
        ) : (
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" onClick={() => updateSettings({ privacy: { pausedUntil: Date.now() + 3_600_000 } })}>
              <Pause /> 1 hour
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() + 1);
                d.setHours(8, 0, 0, 0);
                updateSettings({ privacy: { pausedUntil: d.getTime() } });
              }}
            >
              Until tomorrow
            </Button>
            <Button variant="outline" size="sm" onClick={() => updateSettings({ privacy: { pausedUntil: -1 } })}>
              Until I resume
            </Button>
          </div>
        )}
      </Row>
      <Row label="Keep page snapshots for" hint="Snapshots of closed tabs are deleted after this many days. Archive entries keep only the title and URL." wide>
        <SliderField value={s.privacy.snapshotRetentionDays} min={1} max={30} step={1} unit="days" onCommit={(v) => updateSettings({ privacy: { snapshotRetentionDays: v } })} />
      </Row>
    </Section>
  );
}

function Rules() {
  const rules = useLiveQuery(() => db.rules.orderBy('pattern').toArray(), []) ?? [];
  const [kind, setKind] = React.useState<'domain' | 'url-prefix'>('domain');
  const [pattern, setPattern] = React.useState('');
  const [mission, setMission] = React.useState('');
  return (
    <Section id="rules" title="Learned rules" hint="Every time you move a tab on the board, TabLens remembers it here and applies it before anything else on the next analysis.">
      {rules.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-muted-foreground">
                <th className="px-5 py-2 font-medium">Tabs matching</th>
                <th className="px-2 py-2 font-medium">Go to mission</th>
                <th className="px-2 py-2 font-medium">Learned</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="max-w-80 truncate px-5 py-2 font-mono text-[12px]" title={r.pattern}>
                    {r.kind === 'domain' ? `any page on ${r.pattern}` : r.pattern}
                  </td>
                  <td className="px-2 py-2 font-medium">{r.missionName}</td>
                  <td className="px-2 py-2 text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="pr-3">
                    <Button size="icon-sm" variant="ghost" aria-label="Delete rule" onClick={() => rpc('deleteRule', { ruleId: r.id })}>
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 py-6 text-[13px] text-muted-foreground">No rules yet. Drag a tab to a different mission on the board to teach TabLens.</div>
      )}
      <form
        className="flex flex-wrap items-end gap-2 px-5 py-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!pattern.trim() || !mission.trim()) return;
          await db.rules.put({ id: uid('r'), kind, pattern: pattern.trim().replace(/^https?:\/\/(www\.)?/, ''), missionName: mission.trim(), createdFrom: 'Added in settings', createdAt: Date.now() });
          setPattern('');
          setMission('');
          toast('Rule added');
          rpc('analyze', {}).catch(() => {});
        }}
      >
        <div className="space-y-1">
          <Label>Match</Label>
          <Select
            value={kind}
            onChange={setKind}
            options={[
              { value: 'domain', label: 'Site' },
              { value: 'url-prefix', label: 'URL starts with' },
            ]}
            className="min-w-36"
          />
        </div>
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor="rule-pattern">{kind === 'domain' ? 'Site' : 'URL prefix'}</Label>
          <Input id="rule-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={kind === 'domain' ? 'linear.app' : 'github.com/acme/expense-app'} />
        </div>
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor="rule-mission">Mission</Label>
          <Input id="rule-mission" value={mission} onChange={(e) => setMission(e.target.value)} placeholder="Work: Expense app" />
        </div>
        <Button type="submit" variant="outline" disabled={!pattern.trim() || !mission.trim()}>
          <Plus /> Add rule
        </Button>
      </form>
    </Section>
  );
}

function Data() {
  const [usage, setUsage] = React.useState<string>('');
  const counts = useLiveQuery(async () => ({ tabs: await db.tabs.count(), snapshots: await db.snapshots.count(), archive: await db.archive.count(), saves: await db.saves.count(), rules: await db.rules.count() }), []);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    navigator.storage?.estimate().then((e) => setUsage(`${((e.usage ?? 0) / 1_048_576).toFixed(1)} MB`));
  }, [counts]);

  const exportJson = async () => {
    const { json } = await rpc('exportData', {});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `tablens-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Section id="data" title="Your data" hint="Stored in this browser only. No account, no server.">
      <Row label="Storage used" hint={counts ? `${counts.tabs} tab records · ${counts.snapshots} page snapshots · ${counts.archive} archived · ${counts.saves} saves · ${counts.rules} rules` : '…'}>
        <span className="tabular text-[14px] font-medium">{usage}</span>
      </Row>
      <Row label="Export" hint="Archive, saves, notes, rules and settings as JSON. Your API key is left out.">
        <Button variant="outline" onClick={exportJson}>
          <Download /> Export JSON
        </Button>
      </Row>
      <Row label="Import" hint="Adds archive, saves and rules from a TabLens export.">
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = await rpc('importData', { json: await f.text() });
            if (r.ok) toast(r.message);
            else toast.error(r.message);
            e.target.value = '';
          }}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload /> Import JSON
        </Button>
      </Row>
      <Row label="Delete all data" hint="Removes every record, snapshot, archived tab, save, note, rule and setting. Your open tabs and Chrome bookmarks are not touched.">
        <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
          <Trash2 /> Delete all data
        </Button>
      </Row>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogTitle>Delete all TabLens data?</DialogTitle>
          <DialogDescription>
            This removes {counts?.archive ?? 0} archived tabs, {counts?.saves ?? 0} saves with their notes, {counts?.rules ?? 0} learned rules, all behaviour history and your settings, including your Gemini API key. It can't be undone.
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const r = await rpc('deleteAllData', {});
                setConfirmOpen(false);
                if (r.ok) toast('All TabLens data deleted');
                else toast.error('Some data could not be deleted. Try again.');
              }}
            >
              Delete everything
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

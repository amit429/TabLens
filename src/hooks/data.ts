import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { DEFAULT_SETTINGS, getSettings, onSettingsChanged, type Settings } from '@/lib/settings';
import type { Analysis, Mission, TabVerdict } from '@/lib/types';

export function useAnalysis(): Analysis | null | undefined {
  // undefined = loading, null = never analysed
  return useLiveQuery(async () => (await db.analyses.orderBy('createdAt').last()) ?? null, []);
}

export function useSettings(): Settings {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    getSettings().then(setS);
    return onSettingsChanged(setS);
  }, []);
  return s;
}

/** Live view of Chrome's open tabs, refreshed on every tab event. */
export function useChromeTabs(): chrome.tabs.Tab[] {
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(t);
      t = setTimeout(() => chrome.tabs.query({}).then(setTabs), 120);
    };
    chrome.tabs.query({}).then(setTabs);
    const evs = [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onActivated] as chrome.events.Event<() => void>[];
    evs.forEach((e) => e.addListener(refresh));
    return () => evs.forEach((e) => e.removeListener(refresh));
  }, []);
  return tabs;
}

export interface LiveTab {
  tab: chrome.tabs.Tab;
  verdict?: TabVerdict;
}

export interface LiveMission extends Mission {
  live: LiveTab[];
}

/** Joins the last analysis with live tabs: drops closed tabs, keeps order, and lists new tabs separately. */
export function useLiveMissions(a: Analysis | null | undefined, tabs: chrome.tabs.Tab[]) {
  return useMemo(() => {
    const byId = new Map(tabs.map((t) => [t.id!, t]));
    const ext = `chrome-extension://${chrome.runtime.id}`;
    const seen = new Set<number>();
    const missions: LiveMission[] = (a?.missions ?? []).map((m) => {
      const live = m.tabIds
        .map((id) => byId.get(id))
        .filter((t): t is chrome.tabs.Tab => !!t)
        .map((t) => {
          seen.add(t.id!);
          return { tab: t, verdict: a!.verdicts[t.id!] };
        });
      return { ...m, live };
    });
    const fresh = tabs.filter((t) => !seen.has(t.id!) && !(t.url ?? '').startsWith(ext)).map((t) => ({ tab: t }));
    return { missions, fresh };
  }, [a, tabs]);
}

export function useTheme() {
  const s = useSettings();
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = s.theme === 'dark' || (s.theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [s.theme]);
}

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

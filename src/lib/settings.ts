export type AiMode = 'auto' | 'nano' | 'cloud' | 'off';
export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  theme: Theme;
  /** Days since last visit. */
  thresholds: {
    simmeringDays: number;
    staleDays: number;
    abandonedDays: number;
    /** Read depth range (%) that counts as "unfinished". */
    unfinishedMin: number;
    unfinishedMax: number;
    /** Engagement at or above this keeps a 3–7 day old tab out of "stale". */
    staleEngagement: number;
  };
  weights: { active: number; scroll: number; visits: number; interactions: number };
  /** Below this, tabs land in "Unsorted". */
  confidenceThreshold: number;
  /** Clustering similarity cut-off (0–1). Lower = bigger missions. */
  similarity: number;
  ai: {
    mode: AiMode;
    /** The user agreed to send short tab descriptors to TabLens AI (Gemini, hosted by TabLens). Asked once. */
    cloudConsent: boolean;
  };
  privacy: {
    excludedDomains: string[];
    trackIncognito: boolean;
    /** Epoch ms; tracking paused until then. 0 = not paused, Infinity not storable so use -1 for indefinitely. */
    pausedUntil: number;
    snapshotRetentionDays: number;
  };
  grouping: {
    /**
     * Chrome tab groups live inside one window. When a mission's tabs are spread across windows:
     * 'gather' moves them into the window holding most of them (one group per mission);
     * 'per-window' leaves tabs where they are and creates a same-named group in each window.
     */
    crossWindow: 'gather' | 'per-window';
    /** Once a mission is grouped in Chrome, add its new tabs to the group automatically. */
    autoSync: boolean;
  };
  features: {
    alreadyOpenNudge: boolean;
    weeklyDigest: boolean;
    dailyAnalysis: boolean;
    badge: boolean;
  };
  onboarded: boolean;
  installedAt: number;
  /** Random id used only for TabLens AI's per-install daily quota. Not linked to you. */
  installId: string;
}

export const SENSITIVE_PRESETS: Record<string, string[]> = {
  Banking: [
    'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'capitalone.com', 'hsbc.com', 'barclays.co.uk',
    'hdfcbank.com', 'icicibank.com', 'onlinesbi.sbi', 'sbi.co.in', 'axisbank.com', 'kotak.com', 'revolut.com', 'monzo.com',
  ],
  Payments: ['paypal.com', 'stripe.com', 'wise.com', 'venmo.com', 'paytm.com', 'phonepe.com', 'razorpay.com', 'pay.google.com'],
  Health: ['mychart.org', 'patient.info', 'practo.com', 'zocdoc.com', 'teladoc.com', 'healthvault.com', 'myhealth.va.gov'],
  Passwords: ['1password.com', 'bitwarden.com', 'lastpass.com', 'dashlane.com', 'accounts.google.com', 'login.microsoftonline.com'],
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  thresholds: {
    simmeringDays: 1,
    staleDays: 3,
    abandonedDays: 7,
    unfinishedMin: 20,
    unfinishedMax: 80,
    staleEngagement: 0.55,
  },
  weights: { active: 0.4, scroll: 0.3, visits: 0.2, interactions: 0.1 },
  confidenceThreshold: 0.35,
  similarity: 0.16,
  ai: { mode: 'auto', cloudConsent: false },
  privacy: {
    excludedDomains: [
      ...SENSITIVE_PRESETS.Banking!,
      ...SENSITIVE_PRESETS.Payments!,
      ...SENSITIVE_PRESETS.Health!,
      ...SENSITIVE_PRESETS.Passwords!,
    ],
    trackIncognito: false,
    pausedUntil: 0,
    snapshotRetentionDays: 7,
  },
  grouping: { crossWindow: 'gather', autoSync: true },
  features: { alreadyOpenNudge: true, weeklyDigest: true, dailyAnalysis: true, badge: true },
  onboarded: false,
  installedAt: 0,
  installId: '',
};

const KEY = 'settings';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

function merge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const b = (base as any)[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' ? merge(b, v as any) : v;
  }
  return out;
}

export async function getSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as DeepPartial<Settings> | undefined;
  return merge(DEFAULT_SETTINGS, stored);
}

export async function updateSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const next = merge(await getSettings(), patch);
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[KEY]) cb(merge(DEFAULT_SETTINGS, changes[KEY].newValue as DeepPartial<Settings>));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export function isPaused(s: Settings, now = Date.now()): boolean {
  return s.privacy.pausedUntil === -1 || s.privacy.pausedUntil > now;
}

export type { DeepPartial };
export { merge as mergeDeep };

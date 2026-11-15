/**
 * Memory for "add this tab to the group?" prompts. Tab ids only live for a browser session, so
 * this lives in session storage too.
 * - A "no" is kept for that tab and that group: never asked again, never added automatically.
 *   Another group, a re-analysis that makes a new group, or the user moving the tab is still fine.
 * - A prompt that was shown but not answered isn't repeated for a while, so it can't nag.
 */

const KEY = 'joinPrompts';
const ASK_AGAIN_AFTER = 30 * 60_000;

interface State {
  declined: string[];
  asked: Record<string, number>;
}

/** Groups are named after their mission, so the name identifies "the same group" across windows. */
const keyOf = (tabId: number, group: string) => `${tabId}|${group.trim().toLowerCase()}`;

async function load(): Promise<State> {
  const s = (await chrome.storage.session.get(KEY))[KEY] as State | undefined;
  return { declined: s?.declined ?? [], asked: s?.asked ?? {} };
}

async function save(s: State) {
  // Bounded: old entries fall off; tab ids aren't reused within a session.
  s.declined = s.declined.slice(-500);
  const now = Date.now();
  s.asked = Object.fromEntries(Object.entries(s.asked).filter(([, at]) => now - at < ASK_AGAIN_AFTER));
  await chrome.storage.session.set({ [KEY]: s });
}

export async function isDeclined(tabId: number, group: string): Promise<boolean> {
  return (await load()).declined.includes(keyOf(tabId, group));
}

/** True if this tab may be asked about this group now: not declined and not asked recently. */
export async function mayAsk(tabId: number, group: string, now = Date.now()): Promise<boolean> {
  const s = await load();
  const k = keyOf(tabId, group);
  return !s.declined.includes(k) && !(now - (s.asked[k] ?? 0) < ASK_AGAIN_AFTER);
}

export async function markAsked(tabId: number, group: string) {
  const s = await load();
  s.asked[keyOf(tabId, group)] = Date.now();
  await save(s);
}

export async function decline(tabId: number, group: string) {
  const s = await load();
  const k = keyOf(tabId, group);
  if (!s.declined.includes(k)) s.declined.push(k);
  await save(s);
}

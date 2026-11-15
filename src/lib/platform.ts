/**
 * The few places Chrome and Firefox differ. Everything else uses the shared `chrome.*` namespace,
 * which Firefox also provides (with promises) in Manifest V3.
 */

/** Set by WXT at build time (`wxt build -b firefox`). */
export const IS_FIREFOX: boolean = import.meta.env.FIREFOX;

/** For copy like "Group in Chrome". Edge and Brave run the Chrome build and understand "Chrome tab groups". */
export const BROWSER_NAME = IS_FIREFOX ? 'Firefox' : 'Chrome';

type FirefoxApis = {
  sidebarAction: { open(): Promise<void> };
  permissions: {
    request(p: { data_collection: string[] }): Promise<boolean>;
    contains(p: { data_collection: string[] }): Promise<boolean>;
  };
};
const firefox = () => (globalThis as unknown as { browser: FirefoxApis }).browser;

/**
 * Opens the side panel (Chrome) or sidebar (Firefox). Firefox only opens it from a user action,
 * so call this first in a click/command handler, before any await.
 */
export function openSidePanel(target: { windowId?: number; tabId?: number }): Promise<void> {
  if (IS_FIREFOX) return firefox().sidebarAction.open();
  if (target.tabId !== undefined) return chrome.sidePanel.open({ tabId: target.tabId });
  return chrome.sidePanel.open({ windowId: target.windowId! });
}

/**
 * What TabLens AI sends, in Firefox's data-collection terms: tab titles and sites (browsing activity)
 * and short page summaries (website content). Declared optional in the Firefox manifest.
 */
export const CLOUD_DATA_COLLECTION = ['browsingActivity', 'websiteContent'];

/** Asks Firefox for the data-collection permission TabLens AI needs. Call from a click, first thing. Chrome has no equivalent. */
export async function requestCloudDataConsent(): Promise<boolean> {
  if (!IS_FIREFOX) return true;
  return firefox()
    .permissions.request({ data_collection: CLOUD_DATA_COLLECTION })
    .catch(() => false);
}

/** False on Firefox once the user has revoked TabLens AI's data collection in the add-ons manager. */
export async function hasCloudDataConsent(): Promise<boolean> {
  if (!IS_FIREFOX) return true;
  return firefox()
    .permissions.contains({ data_collection: CLOUD_DATA_COLLECTION })
    .catch(() => false);
}

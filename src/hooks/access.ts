import * as React from 'react';
import { rpc } from '@/lib/rpc';
import { act } from '@/lib/ui-actions';

export function usePageAccess() {
  const [has, setHas] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    const check = () => chrome.permissions.contains({ origins: ['<all_urls>'] }).then(setHas);
    check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
  }, []);
  return has;
}

/** Must run from a click: Chrome only shows the permission prompt for user gestures. */
export async function requestAccess() {
  const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
  if (granted) await act(rpc('enableContentReading', {}).then(() => ({ count: 0, message: 'Page reading is on. Missions sharpen as pages load.' })));
}


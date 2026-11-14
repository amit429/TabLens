import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

/** The production TabLens API (server/), which holds the Gemini key. Override with TABLENS_API=… */
const TABLENS_API = process.env.TABLENS_API ?? 'https://tablens-api.amitpile2002.workers.dev';

/**
 * Public key that pins the extension id to pcafglkkkambggigaheapgbiogepdnnd for unpacked/dev
 * installs, so the API can allow-list it. Not secret (the private half stays out of the repo).
 * The Chrome Web Store rejects a `key` field, so store builds (TABLENS_STORE=1) leave it out and
 * the store id gets added to ALLOWED_EXTENSION_IDS after publishing.
 */
const MANIFEST_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA9WsY3lzusvz0O59XdyBd+AxD6H1Xe5I0AlOoWWJMJc7h2kjCvQWD7nccMHicT5V4wFgPo3gGPeNTOU0PaQJ9j9I7EYfQedEb9fFhKANWdmFAN7LRfU9nQEr3MlbhNa2bzxYX3ohtp7m+rOzxa82xR9fDSYvkGRuJIH53ZTwQ6nqFMqvWHoW/UqU2EZutwzvr8iIzNL+w/N84G60GDmEPwEcVvXIWlbAYD8yevnogEzIGpjseNE4M3niAz+sdwP+VunewA1f9yXrql4Pgy+6cYI3DUxNMApYn77zLEKtYST3Kjrocj5ko7vG2yX6sQB8y68G7+10FciQJgrtkIja3HwIDAQAB';

export default defineConfig({
  srcDir: 'src',
  outDir: process.env.TABLENS_E2E ? '.output-e2e' : '.output',
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // Content scripts are registered at runtime after the user opts in, so page access must stay
    // optional. WXT would otherwise add the script's match patterns as install-time host permissions.
    // TABLENS_E2E=1 builds a test variant with the optional permissions pre-granted.
    'build:manifestGenerated': (_wxt, manifest) => {
      if (!process.env.TABLENS_STORE) (manifest as { key?: string }).key = MANIFEST_KEY;
      if (process.env.TABLENS_E2E) {
        manifest.permissions = [...(manifest.permissions ?? []), 'bookmarks'];
        return;
      }
      delete manifest.host_permissions;
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      'import.meta.env.WXT_TABLENS_API': JSON.stringify(TABLENS_API),
    },
  }),
  manifest: {
    name: 'TabLens',
    description:
      "Reads what's in your tabs and how you used them, groups them into missions and tells you what to keep, group or let go.",
    permissions: [
      'tabs',
      'tabGroups',
      'storage',
      'unlimitedStorage',
      'idle',
      'alarms',
      'sidePanel',
      'scripting',
      'contextMenus',
      'notifications',
      'favicon',
    ],
    optional_permissions: ['bookmarks'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: 'TabLens' },
    side_panel: { default_path: 'sidepanel.html' },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+L' },
        description: 'Open the TabLens popup',
      },
      'open-dashboard': {
        suggested_key: { default: 'Alt+Shift+D' },
        description: 'Open the TabLens dashboard',
      },
      'open-side-panel': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Open the TabLens side panel',
      },
    },
  },
});

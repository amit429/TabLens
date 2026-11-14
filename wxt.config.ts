import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// Build-time configuration comes from a git-ignored .env (see .env.example) or the environment.
// Nothing deployment-specific lives in the repo: a fresh clone builds with no AI server and works
// with on-device Gemini Nano and heuristics.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env — fine */
}

/** Your TabLens API (server/), which holds the Gemini key. Empty = TabLens AI is off in this build. */
const TABLENS_API = (process.env.TABLENS_API ?? '').replace(/\/+$/, '');

/**
 * Optional public key that pins the extension id for unpacked builds, so your API's allow-list can
 * name it. Generate one with `pnpm keygen`. The Chrome Web Store rejects a `key` field, so store
 * builds (TABLENS_STORE=1) leave it out; add the store's id to the allow-list after publishing.
 */
const MANIFEST_KEY = process.env.TABLENS_MANIFEST_KEY ?? '';

export default defineConfig({
  srcDir: 'src',
  outDir: process.env.TABLENS_E2E ? '.output-e2e' : '.output',
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // Content scripts are registered at runtime after the user opts in, so page access must stay
    // optional. WXT would otherwise add the script's match patterns as install-time host permissions.
    // TABLENS_E2E=1 builds a test variant with the optional permissions pre-granted.
    'build:manifestGenerated': (_wxt, manifest) => {
      if (MANIFEST_KEY && !process.env.TABLENS_STORE) (manifest as { key?: string }).key = MANIFEST_KEY;
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

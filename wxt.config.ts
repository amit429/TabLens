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

/**
 * Firefox add-on id (browser_specific_settings.gecko.id). Firefox calls your API from a random
 * per-install origin, so the API's allow-list names this id instead. Use your own for AMO.
 */
const FIREFOX_ID = process.env.TABLENS_FIREFOX_ID || 'tablens-dev@localhost';

export default defineConfig({
  srcDir: 'src',
  // Visible folders (macOS file pickers hide dot-folders, which made "Load unpacked" awkward).
  outDir: process.env.TABLENS_E2E ? 'dist-e2e' : 'dist',
  modules: ['@wxt-dev/module-react'],
  // The sources zip AMO reviewers rebuild from: code and build config only. Never the git-ignored
  // release/ drafts, build output, keys or env files, and not the video or screenshots.
  zip: {
    excludeSources: ['release/**', 'dist/**', 'dist-e2e/**', '.keys/**', '.env', '.env.local', 'assets/**', 'docs/screenshots/**', 'server/node_modules/**'],
  },
  hooks: {
    // Content scripts are registered at runtime after the user opts in, so page access must stay
    // optional. WXT would otherwise add the script's match patterns as install-time host permissions.
    // TABLENS_E2E=1 builds a test variant with the optional permissions pre-granted.
    'build:manifestGenerated': (wxt, manifest) => {
      // The key pins a Chrome extension id; Firefox uses browser_specific_settings.gecko.id instead.
      if (MANIFEST_KEY && !process.env.TABLENS_STORE && wxt.config.browser !== 'firefox') (manifest as { key?: string }).key = MANIFEST_KEY;
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
  manifest: ({ browser }) => {
    const firefox = browser === 'firefox';
    return {
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
        'scripting',
        'contextMenus',
        'notifications',
        // Firefox has a sidebar instead of a side panel and no favicon service.
        ...(firefox ? [] : ['sidePanel', 'favicon']),
      ],
      optional_permissions: ['bookmarks'],
      optional_host_permissions: ['http://*/*', 'https://*/*'],
      action: { default_title: 'TabLens' },
      ...(firefox ? {} : { side_panel: { default_path: 'sidepanel.html' } }),
      commands: {
        _execute_action: {
          suggested_key: { default: 'Alt+Shift+L' },
          description: 'Open the TabLens popup',
        },
        'open-dashboard': {
          suggested_key: { default: 'Alt+Shift+D' },
          description: 'Open the TabLens dashboard',
        },
        [firefox ? '_execute_sidebar_action' : 'open-side-panel']: {
          suggested_key: { default: 'Alt+Shift+S' },
          description: 'Open the TabLens side panel',
        },
      },
      ...(firefox && {
        browser_specific_settings: {
          gecko: {
            id: FIREFOX_ID,
            // Tab groups and the tabGroups API arrived in 139; data_collection_permissions in 142.
            strict_min_version: '142.0',
            // TabLens AI (opt-in) sends tab titles, sites and short page summaries to the TabLens API.
            data_collection_permissions: TABLENS_API ? { required: ['none'], optional: ['browsingActivity', 'websiteContent'] } : { required: ['none'] },
          },
        },
      }),
    };
  },
});

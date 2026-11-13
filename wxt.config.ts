import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  outDir: process.env.TABLENS_E2E ? '.output-e2e' : '.output',
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // Content scripts are registered at runtime after the user opts in, so page access must stay
    // optional. WXT would otherwise add the script's match patterns as install-time host permissions.
    // TABLENS_E2E=1 builds a test variant with the optional permissions pre-granted.
    'build:manifestGenerated': (_wxt, manifest) => {
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
      // The TabLens API (server/) that holds the Gemini key. Override with TABLENS_API=… at build time.
      'import.meta.env.WXT_TABLENS_API': JSON.stringify(process.env.TABLENS_API ?? 'http://localhost:8787'),
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

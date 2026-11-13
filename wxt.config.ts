import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
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
    optional_host_permissions: ['<all_urls>'],
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

import { defineConfig } from 'wxt';

// See the integrated module for React plugin setup (auto-detected via @wxt-dev/module-react).

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'SCIMEM',
    description: 'One-click full-page capture + ask against your project memory',
    version: '0.1.0',
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting', 'contextMenus', 'tabs'],
    host_permissions: [
      // page capture reads the live DOM + takes screenshots on the active tab
      '<all_urls>',
      // local API during development
      'http://localhost:3000/*',
      'http://127.0.0.1:3000/*',
      // Supabase project (auth + storage)
      'https://xccudezjjdtzpyojyodp.supabase.co/*',
    ],
    optional_host_permissions: ['https://chatgpt.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*'],
    side_panel: { default_path: 'sidepanel.html' },
    action: { default_title: 'Open SCIMEM' },
  },
  dev: {
    server: { port: 3131 },
  },
});
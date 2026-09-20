import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';

/** Runs INSIDE the target page: captures its live DOM (post-JS state). */
function extractPage(): { url: string; title: string; html: string } {
  return {
    url: window.location.href,
    title: document.title,
    html: document.documentElement.outerHTML,
  };
}

export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel (Chrome-only API).
  if (import.meta.env.BROWSER === 'chrome') {
    browser.sidePanel
      ?.setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
  }

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'scimem:capture') return;

    (async () => {
      try {
        const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id) {
          sendResponse({ ok: false, error: 'no active tab found' });
          return;
        }

        const results = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractPage,
        });
        const data = results?.[0]?.result;
        if (!data) {
          sendResponse({ ok: false, error: 'page extraction returned nothing' });
          return;
        }

        // Visible-viewport screenshot (data:image/png URL) — Chrome only.
        let screenshot: string | null = null;
        if (import.meta.env.BROWSER === 'chrome' && tab.windowId !== undefined) {
          try {
            screenshot = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
          } catch {
            screenshot = null;
          }
        }

        sendResponse({
          ok: true,
          data: { url: data.url, title: data.title, html: data.html, screenshot },
        });
      } catch (e) {
        sendResponse({ ok: false, error: (e as Error).message });
      }
    })();

    return true; // async response
  });
});
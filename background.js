'use strict';

/**
 * Clone WebBrain — MV3 service worker.
 *
 * Responsibilities are intentionally minimal: seed storage defaults and keep the
 * extension privacy contract (only the API base URL + extension API key are ever
 * persisted). MongoDB credentials never reach the extension.
 */

const STORAGE_KEYS = {
  apiBaseUrl: 'cloneWebBrain.apiBaseUrl',
  extensionApiKey: 'cloneWebBrain.extensionApiKey'
};

const DEFAULTS = {
  [STORAGE_KEYS.apiBaseUrl]: '',
  [STORAGE_KEYS.extensionApiKey]: ''
};

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const current = await chrome.storage.local.get(Object.keys(DEFAULTS));
    const missing = {};
    for (const key of Object.keys(DEFAULTS)) {
      if (current[key] === undefined) missing[key] = DEFAULTS[key];
    }
    if (Object.keys(missing).length) {
      await chrome.storage.local.set(missing);
    }
    console.log(
      `[Clone WebBrain] Installed (${details.reason}). Settings keys: ${Object.keys(DEFAULTS).join(', ')}`
    );
  } catch (err) {
    console.error('[Clone WebBrain] Failed to initialise storage defaults:', err);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'CLONE_WEBBRAIN_PING') return false;
  sendResponse({ ok: true, name: 'Clone WebBrain', time: Date.now() });
  return true;
});

console.log('[Clone WebBrain] Service worker ready.');

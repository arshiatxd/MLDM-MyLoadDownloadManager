const BRIDGE_PORTS = [49173, 49174, 49175, 49176, 49177, 49178, 49179, 49180, 49181, 49182];
const NATIVE_HOST_NAME = 'com.myload.host';

const DEFAULT_SETTINGS = {
  enabled: true,
  port: 49173,
  minSizeKb: 0,
  excludedDomains: [],
};

const MENU_ID = 'myload-download-link';

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    enabled: Boolean(stored.enabled),
    port: Number(stored.port) || 49173,
    minSizeKb: Math.max(0, Number(stored.minSizeKb) || 0),
    excludedDomains: Array.isArray(stored.excludedDomains) ? stored.excludedDomains : [],
  };
}

async function syncBadge() {
  const { enabled } = await getSettings();
  if (enabled) {
    await chrome.action.setBadgeText({ text: '' });
  } else {
    await chrome.action.setBadgeBackgroundColor({ color: '#52525f' });
    await chrome.action.setBadgeText({ text: 'OFF' });
  }
}

function registerContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Download with MyLoad',
      contexts: ['link', 'image', 'video', 'audio'],
    });
  });
}

function isDomainExcluded(rawUrl, excludedDomains) {
  if (!excludedDomains.length) return false;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return excludedDomains.some((entry) => {
      const rule = String(entry || '').trim().toLowerCase();
      if (!rule) return false;
      return host === rule || host.endsWith(`.${rule}`);
    });
  } catch {
    return false;
  }
}

function isHttpOrHttps(url) {
  return /^https?:\/\//i.test(url);
}

function isSupportedInterceptUrl(url) {
  return /^https?:\/\//i.test(url) || /^magnet:\?xt=urn:btih:/i.test(url);
}

async function getCookieHeader(url) {
  if (!isHttpOrHttps(url)) return undefined;
  try {
    const cookies = await chrome.cookies.getAll({ url });
    if (!cookies || cookies.length === 0) return undefined;
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return undefined;
  }
}

function looksLikeMultiPartHint(url, fileName) {
  const sample = `${fileName || ''} ${url || ''}`;
  if (/(?:[._-]part\d+|\.\d{3,4}(?:$|[/?#])|\.[rz]\d{2,3}(?:$|[/?#]))/i.test(sample)) {
    return true;
  }
  return /(?:^|[^a-z0-9])(?:part|cd|disc|disk|vol)[._-]?\d{1,3}(?:[^a-z0-9]|$)/i.test(sample);
}

async function collectRelatedPartsFromTab(tabId, targetUrl, fileName) {
  if (!looksLikeMultiPartHint(targetUrl, fileName)) return undefined;
  try {
    let resolvedTabId = typeof tabId === 'number' && tabId >= 0 ? tabId : undefined;
    if (resolvedTabId === undefined) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!activeTab || typeof activeTab.id !== 'number') return undefined;
      if (!activeTab.url || !isHttpOrHttps(activeTab.url)) return undefined;
      resolvedTabId = activeTab.id;
    }

    let targetHost = '';
    try {
      targetHost = new URL(targetUrl).hostname.toLowerCase();
    } catch {
      return undefined;
    }

    const runScript = chrome.scripting.executeScript({
      target: { tabId: resolvedTabId },
      args: [targetHost],
      func: (allowedHost) => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        const seen = new Set();
        const out = [];
        const partRe = /(?:[._-]part\d+|\.\d{3,4}$|\.[rz]\d{2,3}$|[_-]\d{2,3}\.[a-z0-9]{2,6}$)/i;
        for (const a of anchors) {
          const href = a.href;
          if (!href || seen.has(href)) continue;
          let u;
          try {
            u = new URL(href);
          } catch {
            continue;
          }
          if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
          if (u.hostname.toLowerCase() !== allowedHost) continue;
          const dlAttr = (a.getAttribute('download') || '').trim().slice(0, 180);
          const leaf = u.pathname.split('/').filter(Boolean).pop() || '';
          if (!partRe.test(leaf) && !partRe.test(dlAttr)) continue;
          seen.add(href);
          out.push(dlAttr ? { url: href, fileName: dlAttr } : { url: href });
          if (out.length >= 100) break;
        }
        return out;
      },
    });

    const timeout = new Promise((resolve) => setTimeout(() => resolve([]), 450));
    const results = await Promise.race([runScript, timeout]);
    if (!Array.isArray(results) || results.length === 0) return undefined;
    const firstResult = results[0];
    const items = firstResult && Array.isArray(firstResult.result) ? firstResult.result : [];
    return items.length > 0 ? items : undefined;
  } catch {
    return undefined;
  }
}

async function probeBridgePort(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 550);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
      headers: { 'X-MyLoad-Client': 'myload-extension' },
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverBridgePort(preferredPort) {
  const candidates = [preferredPort, ...BRIDGE_PORTS.filter((p) => p !== preferredPort)];
  if (await probeBridgePort(candidates[0])) {
    return candidates[0];
  }
  const rest = candidates.slice(1);
  const results = await Promise.all(
    rest.map(async (p) => ((await probeBridgePort(p)) ? p : null))
  );
  const found = results.find((p) => p !== null) ?? null;
  if (found !== null) {
    await chrome.storage.local.set({ port: found }).catch(() => {});
  }
  return found;
}

async function wakeNativeApp(preferredPort, focusMain = false) {
  if (!chrome.runtime?.sendNativeMessage) {
    return null;
  }
  try {
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: 'ensure-running',
      preferredPort,
      focusMain,
    });
    if (response && response.ok && typeof response.port === 'number') {
      await chrome.storage.local.set({ port: response.port }).catch(() => {});
      return response.port;
    }
    return null;
  } catch {
    return null;
  }
}

async function sendToBridge(port, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/intercept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MyLoad-Client': 'myload-extension',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) return { sent: false, reachable: true };
    const data = await res.json().catch(() => null);
    return { sent: Boolean(data && data.ok), reachable: true };
  } catch {
    return { sent: false, reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

async function sendWithAutoLaunch(port, payload) {
  const direct = await sendToBridge(port, payload);
  if (direct.sent) return true;
  if (direct.reachable) return false;

  const discovered = await discoverBridgePort(port);
  if (discovered !== null && discovered !== port) {
    const viaDiscovered = await sendToBridge(discovered, payload);
    if (viaDiscovered.sent) return true;
    if (viaDiscovered.reachable) return false;
  }

  const wokenPort = await wakeNativeApp(port, false);
  if (wokenPort === null) return false;

  const viaWoken = await sendToBridge(wokenPort, payload);
  return viaWoken.sent;
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
  void syncBadge();
});

chrome.runtime.onStartup.addListener(() => {
  registerContextMenus();
  void syncBadge();
});

chrome.storage.onChanged.addListener(() => {
  void syncBadge();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const targetUrl = (info.linkUrl || info.srcUrl || '').trim();
  if (!targetUrl || !isSupportedInterceptUrl(targetUrl)) return;

  void (async () => {
    const settings = await getSettings();
    const [cookie, relatedParts] = await Promise.all([
      getCookieHeader(targetUrl),
      isHttpOrHttps(targetUrl) ? collectRelatedPartsFromTab(tab && typeof tab.id === 'number' ? tab.id : undefined, targetUrl) : Promise.resolve(undefined),
    ]);
    await sendWithAutoLaunch(settings.port, {
      url: targetUrl,
      referrer: info.pageUrl || undefined,
      cookie,
      userAgent: navigator.userAgent,
      relatedParts,
    });
  })();
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  let didSuggest = false;
  const fallbackSuggest = () => {
    if (didSuggest) return;
    didSuggest = true;
    try {
      suggest();
    } catch {

    }
  };

  if (item.byExtensionId) {
    fallbackSuggest();
    return false;
  }

  const targetUrl = (item.finalUrl || item.url || '').trim();
  if (!isHttpOrHttps(targetUrl)) {
    fallbackSuggest();
    return false;
  }

  void (async () => {
    try {
      const settings = await getSettings();
      if (!settings.enabled) {
        fallbackSuggest();
        return;
      }

      if (
        settings.minSizeKb > 0 &&
        typeof item.fileSize === 'number' &&
        item.fileSize > 0 &&
        item.fileSize < settings.minSizeKb * 1024
      ) {
        fallbackSuggest();
        return;
      }

      if (isDomainExcluded(targetUrl, settings.excludedDomains)) {
        fallbackSuggest();
        return;
      }

      const [cookie, relatedParts] = await Promise.all([
        getCookieHeader(targetUrl),
        collectRelatedPartsFromTab(undefined, targetUrl, item.filename),
      ]);
      const ok = await sendWithAutoLaunch(settings.port, {
        url: targetUrl,
        fileName: item.filename || undefined,
        referrer: item.referrer || undefined,
        cookie,
        userAgent: navigator.userAgent,
        fileSize: typeof item.fileSize === 'number' && item.fileSize >= 0 ? item.fileSize : null,
        mime: item.mime || undefined,
        relatedParts,
      });

      if (!ok) {
        fallbackSuggest();
        return;
      }

      chrome.downloads.cancel(item.id, () => {
        void chrome.runtime.lastError;
        chrome.downloads.erase({ id: item.id }, () => {
          void chrome.runtime.lastError;
          fallbackSuggest();
        });
      });
    } catch {
      fallbackSuggest();
    }
  })();

  return true;
});


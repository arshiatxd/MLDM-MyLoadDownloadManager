const BRIDGE_PORTS = [49173, 49174, 49175, 49176, 49177, 49178, 49179, 49180, 49181, 49182];
const NATIVE_HOST_NAME = 'com.myload.host';

const DEFAULT_SETTINGS = {
  enabled: true,
  port: 49173,
  minSizeKb: 0,
  excludedDomains: [],
};

const MENU_ID = 'myload-download-link';
const MAX_TORRENT_FETCH_BYTES = 10 * 1024 * 1024;

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

function isTorrentCandidate(url, fileName, mime) {
  if (/application\/x-bittorrent/i.test(mime || '')) return true;
  if (/\.torrent$/i.test(fileName || '')) return true;
  if (/\.torrent(?:$|[?#])/i.test(url || '')) return true;
  if (/^magnet:\?xt=urn:btih:/i.test(url || '')) return true;
  return false;
}

async function getMergedCookieHeader(primaryUrl, secondaryUrl) {
  const urls = [];
  if (primaryUrl && isHttpOrHttps(primaryUrl)) urls.push(primaryUrl);
  if (secondaryUrl && secondaryUrl !== primaryUrl && isHttpOrHttps(secondaryUrl)) {
    urls.push(secondaryUrl);
  }
  if (urls.length === 0) return undefined;

  const map = new Map();
  for (const url of urls) {
    try {
      const cookies = await chrome.cookies.getAll({ url });
      for (const c of cookies || []) {
        if (!map.has(c.name)) {
          map.set(c.name, c.value);
        }
      }
    } catch {
    }
  }
  if (map.size === 0) return undefined;
  return Array.from(map.entries())
    .map(([name, val]) => `${name}=${val}`)
    .join('; ');
}

function bytesToBase64(bytes) {
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function fetchTorrentBase64(url) {
  if (!isHttpOrHttps(url)) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(url, {
      credentials: 'include',
      signal: controller.signal,
    });
    if (!res.ok) return undefined;
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (ctype.includes('text/html')) return undefined;
    const buf = await res.arrayBuffer();
    if (buf.byteLength <= 0 || buf.byteLength > MAX_TORRENT_FETCH_BYTES) return undefined;
    const bytes = new Uint8Array(buf);
    if (bytes[0] !== 0x64) return undefined;
    return bytesToBase64(bytes);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function getFallbackTabReferrer() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab && typeof activeTab.url === 'string' && isHttpOrHttps(activeTab.url)) {
      return activeTab.url;
    }
  } catch {
  }
  return undefined;
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

async function probeBridgePort(port, timeoutMs = 350) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
  if (await probeBridgePort(preferredPort, 280)) {
    return preferredPort;
  }
  const rest = BRIDGE_PORTS.filter((p) => p !== preferredPort);
  const results = await Promise.all(
    rest.map(async (p) => ((await probeBridgePort(p, 350)) ? p : null))
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
  const timer = setTimeout(() => controller.abort(), 3000);
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
  const activePort = await discoverBridgePort(port);
  if (activePort !== null) {
    const direct = await sendToBridge(activePort, payload);
    if (direct.sent) return true;
    if (direct.reachable) return false;
  }

  const wokenPort = await wakeNativeApp(port, false);
  if (wokenPort === null) return false;

  const viaWoken = await sendToBridge(wokenPort, payload);
  if (viaWoken.sent) return true;
  if (viaWoken.reachable) return false;

  await new Promise((r) => setTimeout(r, 300));
  const retryWoken = await sendToBridge(wokenPort, payload);
  return retryWoken.sent;
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'MYLOAD_INTERCEPT_LINK') return false;
  const targetUrl = typeof message.url === 'string' ? message.url.trim() : '';
  if (!targetUrl || !isSupportedInterceptUrl(targetUrl)) {
    sendResponse({ ok: false });
    return false;
  }

  void (async () => {
    try {
      const settings = await getSettings();
      if (!settings.enabled || isDomainExcluded(targetUrl, settings.excludedDomains)) {
        sendResponse({ ok: false });
        return;
      }
      const cookie = await getMergedCookieHeader(targetUrl);
      const ok = await sendWithAutoLaunch(settings.port, {
        url: targetUrl,
        referrer: typeof message.referrer === 'string' ? message.referrer : undefined,
        cookie,
        userAgent: navigator.userAgent,
      });
      sendResponse({ ok });
    } catch {
      sendResponse({ ok: false });
    }
  })();

  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const targetUrl = (info.linkUrl || info.srcUrl || '').trim();
  if (!targetUrl || !isSupportedInterceptUrl(targetUrl)) return;

  void (async () => {
    const settings = await getSettings();
    const torrentLike = isTorrentCandidate(targetUrl, undefined, undefined);
    const [cookie, relatedParts, torrentDataBase64] = await Promise.all([
      getMergedCookieHeader(targetUrl),
      isHttpOrHttps(targetUrl) && !torrentLike
        ? collectRelatedPartsFromTab(tab && typeof tab.id === 'number' ? tab.id : undefined, targetUrl)
        : Promise.resolve(undefined),
      torrentLike && isHttpOrHttps(targetUrl)
        ? fetchTorrentBase64(targetUrl)
        : Promise.resolve(undefined),
    ]);
    await sendWithAutoLaunch(settings.port, {
      url: targetUrl,
      referrer: info.pageUrl || undefined,
      cookie,
      userAgent: navigator.userAgent,
      relatedParts,
      torrentDataBase64,
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
  if (!isSupportedInterceptUrl(targetUrl)) {
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

      const torrentLike = isTorrentCandidate(targetUrl, item.filename, item.mime);

      if (
        !torrentLike &&
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

      const [cookie, relatedParts, fallbackReferrer, torrentDataBase64] = await Promise.all([
        getMergedCookieHeader(targetUrl, item.url),
        isHttpOrHttps(targetUrl) && !torrentLike
          ? collectRelatedPartsFromTab(undefined, targetUrl, item.filename)
          : Promise.resolve(undefined),
        item.referrer ? Promise.resolve(item.referrer) : getFallbackTabReferrer(),
        torrentLike && isHttpOrHttps(targetUrl)
          ? fetchTorrentBase64(targetUrl)
          : Promise.resolve(undefined),
      ]);

      const ok = await sendWithAutoLaunch(settings.port, {
        url: targetUrl,
        fileName: item.filename || undefined,
        referrer: item.referrer || fallbackReferrer || undefined,
        cookie,
        userAgent: navigator.userAgent,
        fileSize: typeof item.fileSize === 'number' && item.fileSize >= 0 ? item.fileSize : null,
        mime: item.mime || undefined,
        relatedParts,
        torrentDataBase64,
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


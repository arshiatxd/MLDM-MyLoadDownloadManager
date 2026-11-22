const DEFAULT_SETTINGS = {
  enabled: true,
  port: 49173,
  minSizeKb: 0,
  excludedDomains: [],
};

const PLATFORM_CONFIG = {
  youtube: {
    title: 'YouTube & YouTube Music',
    hint: 'Paste any public YouTube video, Shorts, or YouTube Music link and pick video or audio format.',
    placeholder: 'https://www.youtube.com/watch?v=... or https://music.youtube.com/...',
    hostRe: /(?:^|\.)(?:youtube\.com|youtu\.be)$/i,
  },
  instagram: {
    title: 'Instagram',
    hint: 'Paste a public Reel, photo, video, or multi-slide post. Multi-item posts let you pick slides.',
    placeholder: 'https://www.instagram.com/p/... or /reel/...',
    hostRe: /(?:^|\.)(?:instagram\.com|instagr\.am)$/i,
  },
  tiktok: {
    title: 'TikTok',
    hint: 'Paste a public TikTok video or photo slideshow post. Multi-item slides can be selected individually.',
    placeholder: 'https://www.tiktok.com/@user/video/... or https://vm.tiktok.com/...',
    hostRe: /(?:^|\.)tiktok\.com$/i,
  },
  spotify: {
    title: 'Spotify',
    hint: 'Paste a track, album, or playlist link. Includes cover art, artist, album, and track tags.',
    placeholder: 'https://open.spotify.com/track/... or /album/... or /playlist/...',
    hostRe: /(?:^|\.)(?:spotify\.com|spotify\.link|spotify\.app\.link)$/i,
  },
  custom: {
    title: 'Custom URL',
    hint: 'Paste any public webpage link to scan for embedded videos, audio streams, or images.',
    placeholder: 'https://example.com/page-with-media',
    hostRe: null,
  },
};

const VIDEO_FORMATS = [
  { value: 'mp4', label: 'MP4 (Video)' },
  { value: 'mkv', label: 'MKV (Video)' },
  { value: 'webm', label: 'WebM (Video)' },
  { value: 'mp3', label: 'MP3 (Audio)' },
  { value: 'wav', label: 'WAV (Audio)' },
  { value: 'm4a', label: 'M4A (Audio)' },
  { value: 'flac', label: 'FLAC (Audio)' },
  { value: 'opus', label: 'OPUS (Audio)' },
];

const AUDIO_FORMATS = [
  { value: 'mp3', label: 'MP3 (Audio + Cover)' },
  { value: 'm4a', label: 'M4A (AAC + Cover)' },
  { value: 'flac', label: 'FLAC (Lossless + Cover)' },
  { value: 'wav', label: 'WAV (Uncompressed)' },
  { value: 'opus', label: 'OPUS (Audio)' },
];

const AUDIO_ONLY_FORMAT_SET = new Set(['mp3', 'wav', 'm4a', 'flac', 'opus']);

const VIDEO_QUALITIES = [
  { value: 'best', label: 'Best available' },
  { value: '1080p', label: '1080p HD' },
  { value: '720p', label: '720p HD' },
  { value: '480p', label: '480p' },
  { value: '360p', label: '360p' },
];

const AUDIO_QUALITIES = [
  { value: 'best', label: 'Best bitrate' },
  { value: '320k', label: '320 kbps' },
  { value: '192k', label: '192 kbps' },
  { value: '128k', label: '128 kbps' },
];

const statusPill = document.getElementById('status-pill');
const enabledToggle = document.getElementById('enabled-toggle');
const minSizeInput = document.getElementById('min-size-input');
const excludedInput = document.getElementById('excluded-domains-input');
const portInput = document.getElementById('port-input');
const focusBtn = document.getElementById('focus-btn');
const refreshBtn = document.getElementById('refresh-btn');
const saveHint = document.getElementById('save-hint');

const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
const panelHome = document.getElementById('panel-home');
const panelMedia = document.getElementById('panel-media');
const mediaIconEl = document.getElementById('media-platform-icon');
const mediaTitleTextEl = document.getElementById('media-platform-title-text');
const mediaHintEl = document.getElementById('media-platform-hint');
const mediaUrlInput = document.getElementById('media-url-input');
const useTabBtn = document.getElementById('use-tab-btn');
const scanBtn = document.getElementById('scan-btn');
const mediaLoadingEl = document.getElementById('media-loading');
const mediaErrorEl = document.getElementById('media-error');
const mediaFeedbackEl = document.getElementById('media-feedback');
const mediaResultEl = document.getElementById('media-result');
const resultThumbEl = document.getElementById('result-thumb');
const resultTitleEl = document.getElementById('result-title');
const resultSubEl = document.getElementById('result-sub');
const mediaOptionsEl = document.getElementById('media-options');
const formatWrapEl = document.getElementById('format-wrap');
const formatSelectEl = document.getElementById('media-format-select');
const qualityWrapEl = document.getElementById('quality-wrap');
const qualitySelectEl = document.getElementById('media-quality-select');
const bundleWrapEl = document.getElementById('bundle-wrap');
const bundleSelectEl = document.getElementById('media-bundle-select');
const itemsSectionEl = document.getElementById('media-items-section');
const kindFiltersEl = document.getElementById('media-kind-filters');
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const selectedCountEl = document.getElementById('selected-count');
const itemsListEl = document.getElementById('media-items-list');
const mediaDownloadBtn = document.getElementById('media-download-btn');

let bridgeOnline = false;
let hintTimer = null;
let activeTab = 'home';
let activeTabUrl = '';

const platformStates = {
  youtube: { url: '', loading: false, error: '', feedback: '', scan: null, selectedIds: new Set(), kindFilter: 'all', format: 'mp4', quality: 'best', bundleMode: 'individual' },
  instagram: { url: '', loading: false, error: '', feedback: '', scan: null, selectedIds: new Set(), kindFilter: 'all', format: 'mp4', quality: 'best', bundleMode: 'individual' },
  tiktok: { url: '', loading: false, error: '', feedback: '', scan: null, selectedIds: new Set(), kindFilter: 'all', format: 'mp4', quality: 'best', bundleMode: 'individual' },
  spotify: { url: '', loading: false, error: '', feedback: '', scan: null, selectedIds: new Set(), kindFilter: 'all', format: 'mp3', quality: '320k', bundleMode: 'individual' },
  custom: { url: '', loading: false, error: '', feedback: '', scan: null, selectedIds: new Set(), kindFilter: 'all', format: 'mp4', quality: 'best', bundleMode: 'individual' },
};

function formatSpeed(bytes) {
  if (!bytes || bytes <= 0) return '0 B/s';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB/s`;
  return `${bytes} B/s`;
}

function formatDuration(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getPort() {
  return Math.min(65535, Math.max(1024, Number(portInput.value) || 49173));
}

async function checkBridge(port) {
  statusPill.className = 'pill pill-muted';
  statusPill.textContent = 'Checking...';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
      headers: { 'X-MyLoad-Client': 'myload-extension' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    bridgeOnline = true;
    statusPill.className = 'pill pill-ok';
    statusPill.textContent =
      data.activeCount > 0
        ? `Connected (${data.activeCount} · ${formatSpeed(data.totalDownloadSpeed)})`
        : 'Connected';
    focusBtn.disabled = false;
  } catch {
    bridgeOnline = false;
    statusPill.className = 'pill pill-off';
    statusPill.textContent = 'MyLoad offline';
    focusBtn.disabled = true;
  } finally {
    clearTimeout(timer);
    if (activeTab !== 'home') renderMediaTab();
  }
}

async function saveFromInputs() {
  const port = getPort();
  const minSizeKb = Math.max(0, Number(minSizeInput.value) || 0);
  const excludedDomains = excludedInput.value
    .split(/\r?\n/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  await chrome.storage.local.set({
    enabled: enabledToggle.checked,
    port,
    minSizeKb,
    excludedDomains,
  });

  saveHint.textContent = 'Saved';
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    saveHint.textContent = '';
  }, 1500);

  void checkBridge(port);
}

function setOptions(selectEl, options, selectedVal) {
  while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === selectedVal) o.selected = true;
    selectEl.appendChild(o);
  }
}

function getVisibleItems(st) {
  const items = st.scan?.items || [];
  if (!st.kindFilter || st.kindFilter === 'all') return items;
  return items.filter((it) => it.kind === st.kindFilter);
}

function updateSelectedSummary(st) {
  const allItems = st.scan?.items || [];
  const visibleItems = getVisibleItems(st);
  const totalAll = allItems.length;
  const totalSel = allItems.filter((it) => st.selectedIds.has(it.id)).length;
  const visSel = visibleItems.filter((it) => st.selectedIds.has(it.id)).length;
  selectedCountEl.textContent = `${totalSel} / ${totalAll} selected`;
  selectAllCheckbox.checked = visibleItems.length > 0 && visSel === visibleItems.length;
  selectAllCheckbox.indeterminate = visSel > 0 && visSel < visibleItems.length;

  if (totalAll > 1) {
    mediaDownloadBtn.textContent =
      totalSel > 0 ? `Download Selected (${totalSel})` : 'Select items to download';
    mediaDownloadBtn.disabled = !bridgeOnline || totalSel === 0 || st.loading;
  } else {
    mediaDownloadBtn.textContent = 'Download';
    mediaDownloadBtn.disabled = !bridgeOnline || st.loading;
  }
}

function renderMediaTab() {
  if (activeTab === 'home') {
    panelHome.classList.remove('hidden');
    panelMedia.classList.add('hidden');
    return;
  }

  panelHome.classList.add('hidden');
  panelMedia.classList.remove('hidden');

  const cfg = PLATFORM_CONFIG[activeTab];
  const st = platformStates[activeTab];

  mediaTitleTextEl.textContent = cfg.title;
  while (mediaIconEl.firstChild) mediaIconEl.removeChild(mediaIconEl.firstChild);
  const tabIconSvg = document.querySelector(`.tab-btn[data-tab="${activeTab}"] .tab-icon`);
  if (tabIconSvg) {
    mediaIconEl.appendChild(tabIconSvg.cloneNode(true));
  }
  mediaHintEl.textContent = cfg.hint;
  mediaUrlInput.placeholder = cfg.placeholder;
  mediaUrlInput.value = st.url;
  scanBtn.disabled = st.loading;

  if (st.loading) {
    mediaLoadingEl.classList.remove('hidden');
  } else {
    mediaLoadingEl.classList.add('hidden');
  }

  if (st.error) {
    mediaErrorEl.textContent = st.error;
    mediaErrorEl.classList.remove('hidden');
  } else {
    mediaErrorEl.classList.add('hidden');
  }

  if (st.feedback) {
    mediaFeedbackEl.textContent = st.feedback;
    mediaFeedbackEl.classList.remove('hidden');
  } else {
    mediaFeedbackEl.classList.add('hidden');
  }

  if (!st.scan || !st.scan.ok) {
    mediaResultEl.classList.add('hidden');
    return;
  }

  const scan = st.scan;
  mediaResultEl.classList.remove('hidden');

  if (scan.thumbnailUrl) {
    resultThumbEl.src = scan.thumbnailUrl;
    resultThumbEl.classList.remove('hidden');
    resultThumbEl.onerror = () => resultThumbEl.classList.add('hidden');
  } else {
    resultThumbEl.classList.add('hidden');
  }

  resultTitleEl.textContent = scan.title;
  const subParts = [];
  if (scan.author) subParts.push(scan.author);
  if (scan.album && scan.album !== scan.title) subParts.push(scan.album);
  const dur = formatDuration(scan.durationSeconds);
  if (dur) subParts.push(dur);
  if (scan.items.length > 1) subParts.push(`${scan.items.length} items`);
  resultSubEl.textContent = subParts.join(' · ');

  const isMultiSlide =
    (activeTab === 'instagram' || activeTab === 'tiktok' || activeTab === 'custom') &&
    scan.items.length > 1;
  const hasAnyVideo = scan.items.some((i) => i.kind === 'video');
  const isSpotify = activeTab === 'spotify';
  const isSpotifyCollection = isSpotify && scan.items.length > 1;

  if (isSpotify) {
    mediaOptionsEl.classList.remove('hidden');
    formatWrapEl.classList.remove('hidden');
    setOptions(formatSelectEl, AUDIO_FORMATS, st.format);
    qualityWrapEl.classList.remove('hidden');
    setOptions(qualitySelectEl, AUDIO_QUALITIES, st.quality);
    if (isSpotifyCollection) {
      bundleWrapEl.classList.remove('hidden');
      bundleSelectEl.value = st.bundleMode;
    } else {
      bundleWrapEl.classList.add('hidden');
    }
  } else if (activeTab === 'youtube' || (hasAnyVideo && !isMultiSlide)) {
    mediaOptionsEl.classList.remove('hidden');
    formatWrapEl.classList.remove('hidden');
    setOptions(formatSelectEl, VIDEO_FORMATS, st.format);
    qualityWrapEl.classList.remove('hidden');
    const qList = AUDIO_ONLY_FORMAT_SET.has(st.format) ? AUDIO_QUALITIES : VIDEO_QUALITIES;
    if (!qList.some((q) => q.value === st.quality)) st.quality = 'best';
    setOptions(qualitySelectEl, qList, st.quality);
    bundleWrapEl.classList.add('hidden');
  } else {
    mediaOptionsEl.classList.add('hidden');
  }

  while (kindFiltersEl.firstChild) kindFiltersEl.removeChild(kindFiltersEl.firstChild);
  while (itemsListEl.firstChild) itemsListEl.removeChild(itemsListEl.firstChild);

  if (scan.items.length > 1) {
    const counts = { video: 0, audio: 0, image: 0 };
    for (const it of scan.items) {
      if (it.kind === 'video' || it.kind === 'audio' || it.kind === 'image') {
        counts[it.kind] += 1;
      }
    }
    const presentKinds = Object.keys(counts).filter((k) => counts[k] > 0);
    if (presentKinds.length >= 2) {
      kindFiltersEl.classList.remove('hidden');
      const chips = [
        { key: 'all', label: `All (${scan.items.length})` },
        ...(counts.video > 0 ? [{ key: 'video', label: `Videos (${counts.video})` }] : []),
        ...(counts.audio > 0 ? [{ key: 'audio', label: `Audio (${counts.audio})` }] : []),
        ...(counts.image > 0 ? [{ key: 'image', label: `Images (${counts.image})` }] : []),
      ];
      for (const chip of chips) {
        const chipBtn = document.createElement('button');
        chipBtn.type = 'button';
        chipBtn.className = `kind-chip${st.kindFilter === chip.key ? ' active' : ''}`;
        chipBtn.textContent = chip.label;
        chipBtn.addEventListener('click', () => {
          st.kindFilter = chip.key;
          renderMediaTab();
        });
        kindFiltersEl.appendChild(chipBtn);
      }
    } else {
      kindFiltersEl.classList.add('hidden');
      st.kindFilter = 'all';
    }

    itemsSectionEl.classList.remove('hidden');
    for (const item of getVisibleItems(st)) {
      const row = document.createElement('label');
      row.className = 'item-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = st.selectedIds.has(item.id);
      cb.addEventListener('change', () => {
        if (cb.checked) st.selectedIds.add(item.id);
        else st.selectedIds.delete(item.id);
        updateSelectedSummary(st);
      });
      row.appendChild(cb);

      if (item.thumbnailUrl) {
        const img = document.createElement('img');
        img.className = 'item-thumb';
        img.src = item.thumbnailUrl;
        img.alt = '';
        img.onerror = () => {
          img.style.display = 'none';
        };
        row.appendChild(img);
      }

      const textWrap = document.createElement('div');
      textWrap.className = 'item-text';

      const titleDiv = document.createElement('div');
      titleDiv.className = 'item-title';
      titleDiv.textContent = item.trackNumber
        ? `${item.trackNumber}. ${item.title}`
        : item.title;

      const metaDiv = document.createElement('div');
      metaDiv.className = 'item-meta';
      const metaParts = [];
      if (item.artist) metaParts.push(item.artist);
      if (item.album && item.album !== scan.title) metaParts.push(item.album);
      const itemDur = formatDuration(item.durationSeconds);
      if (itemDur) metaParts.push(itemDur);
      metaDiv.textContent = metaParts.join(' · ') || `${item.kind.toUpperCase()} #${item.index + 1}`;

      textWrap.appendChild(titleDiv);
      textWrap.appendChild(metaDiv);
      row.appendChild(textWrap);

      const badge = document.createElement('span');
      badge.className = 'item-badge';
      badge.textContent = item.kind;
      row.appendChild(badge);

      itemsListEl.appendChild(row);
    }
  } else {
    itemsSectionEl.classList.add('hidden');
  }

  updateSelectedSummary(st);
}

function switchTab(nextTab) {
  activeTab = nextTab;
  for (const btn of tabButtons) {
    const isMatch = btn.dataset.tab === nextTab;
    btn.classList.toggle('active', isMatch);
    btn.setAttribute('aria-selected', String(isMatch));
  }
  if (nextTab !== 'home') {
    const st = platformStates[nextTab];
    const cfg = PLATFORM_CONFIG[nextTab];
    if (!st.url && activeTabUrl) {
      try {
        const host = new URL(activeTabUrl).hostname;
        if (!cfg.hostRe || cfg.hostRe.test(host)) {
          st.url = activeTabUrl;
        }
      } catch {
      }
    }
  }
  renderMediaTab();
}

async function handleScan() {
  if (activeTab === 'home') return;
  const st = platformStates[activeTab];
  const rawUrl = mediaUrlInput.value.trim();
  st.url = rawUrl;
  st.error = '';
  st.feedback = '';

  if (!rawUrl) {
    st.error = `Please paste a ${PLATFORM_CONFIG[activeTab].title} link first.`;
    renderMediaTab();
    return;
  }

  if (!bridgeOnline) {
    st.error = 'MyLoad Download Manager appears offline. Open MyLoad and click Retry.';
    renderMediaTab();
    return;
  }

  st.loading = true;
  st.scan = null;
  renderMediaTab();

  try {
    const res = await fetch(`http://127.0.0.1:${getPort()}/api/v1/media/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MyLoad-Client': 'myload-extension',
      },
      body: JSON.stringify({ platform: activeTab, url: rawUrl }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      st.error = data.error || 'Unable to scan this link.';
      st.scan = null;
    } else {
      st.scan = data;
      st.kindFilter = 'all';
      st.selectedIds = new Set((data.items || []).map((i) => i.id));
      if (activeTab === 'youtube' && data.contentType === 'music') {
        st.format = 'mp3';
        st.quality = '320k';
      }
    }
  } catch {
    st.error = 'Failed to communicate with MyLoad Download Manager.';
  } finally {
    st.loading = false;
    renderMediaTab();
  }
}

async function handleDownloadMedia() {
  if (activeTab === 'home') return;
  const st = platformStates[activeTab];
  if (!st.scan || !st.scan.ok) return;

  const chosen = st.scan.items.filter((i) => st.selectedIds.has(i.id));
  if (chosen.length === 0) return;

  st.error = '';
  st.feedback = '';
  st.loading = true;
  renderMediaTab();

  try {
    const hasAnyVideo = st.scan.items.some((i) => i.kind === 'video');
    const showFormatOptions =
      activeTab === 'spotify' ||
      activeTab === 'youtube' ||
      (hasAnyVideo && st.scan.items.length === 1);
    const payload = {
      platform: activeTab,
      url: st.scan.url,
      title: st.scan.title,
      format: showFormatOptions ? st.format : undefined,
      quality: showFormatOptions ? st.quality : undefined,
      bundleMode: activeTab === 'spotify' && st.scan.items.length > 1 ? st.bundleMode : undefined,
      items: chosen,
    };

    const res = await fetch(`http://127.0.0.1:${getPort()}/api/v1/media/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MyLoad-Client': 'myload-extension',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      st.error = data.error || 'Failed to queue download in MyLoad.';
    } else {
      st.feedback =
        data.mode === 'confirm'
          ? 'Opened download confirmation in MyLoad Download Manager.'
          : `Queued ${data.count} item(s) in MyLoad Download Manager!`;
    }
  } catch {
    st.error = 'Unable to send download to MyLoad Download Manager.';
  } finally {
    st.loading = false;
    renderMediaTab();
  }
}

async function init() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  enabledToggle.checked = Boolean(stored.enabled);
  portInput.value = String(Number(stored.port) || 49173);
  minSizeInput.value = String(Math.max(0, Number(stored.minSizeKb) || 0));
  excludedInput.value = Array.isArray(stored.excludedDomains)
    ? stored.excludedDomains.join('\n')
    : '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && typeof tab.url === 'string' && /^https?:\/\//i.test(tab.url)) {
      activeTabUrl = tab.url;
      const host = new URL(tab.url).hostname;
      for (const p of Object.keys(PLATFORM_CONFIG)) {
        if (PLATFORM_CONFIG[p].hostRe && PLATFORM_CONFIG[p].hostRe.test(host)) {
          platformStates[p].url = tab.url;
          switchTab(p);
          break;
        }
      }
    }
  } catch {
  }

  await checkBridge(getPort());
}

for (const btn of tabButtons) {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab || 'home');
  });
}

mediaUrlInput.addEventListener('input', () => {
  if (activeTab !== 'home') {
    platformStates[activeTab].url = mediaUrlInput.value;
  }
});

mediaUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void handleScan();
  }
});

useTabBtn.addEventListener('click', async () => {
  if (activeTab === 'home') return;
  let pasted = '';
  try {
    pasted = (await navigator.clipboard.readText()).trim();
  } catch {
    pasted = '';
  }
  if (pasted) {
    platformStates[activeTab].url = pasted;
    renderMediaTab();
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && typeof tab.url === 'string') {
      activeTabUrl = tab.url;
      platformStates[activeTab].url = tab.url;
      renderMediaTab();
    }
  } catch {
  }
});

scanBtn.addEventListener('click', () => void handleScan());
mediaDownloadBtn.addEventListener('click', () => void handleDownloadMedia());

formatSelectEl.addEventListener('change', () => {
  if (activeTab === 'home') return;
  const st = platformStates[activeTab];
  st.format = formatSelectEl.value;
  renderMediaTab();
});

qualitySelectEl.addEventListener('change', () => {
  if (activeTab === 'home') return;
  platformStates[activeTab].quality = qualitySelectEl.value;
});

bundleSelectEl.addEventListener('change', () => {
  if (activeTab === 'home') return;
  platformStates[activeTab].bundleMode = bundleSelectEl.value;
});

selectAllCheckbox.addEventListener('change', () => {
  if (activeTab === 'home') return;
  const st = platformStates[activeTab];
  const visibleItems = getVisibleItems(st);
  if (selectAllCheckbox.checked) {
    for (const item of visibleItems) st.selectedIds.add(item.id);
  } else {
    for (const item of visibleItems) st.selectedIds.delete(item.id);
  }
  renderMediaTab();
});

enabledToggle.addEventListener('change', () => void saveFromInputs());
minSizeInput.addEventListener('change', () => void saveFromInputs());
excludedInput.addEventListener('change', () => void saveFromInputs());
portInput.addEventListener('change', () => void saveFromInputs());

refreshBtn.addEventListener('click', () => {
  void checkBridge(getPort());
});

focusBtn.addEventListener('click', async () => {
  const port = getPort();
  try {
    await fetch(`http://127.0.0.1:${port}/api/v1/focus`, {
      method: 'POST',
      headers: { 'X-MyLoad-Client': 'myload-extension' },
    });
  } catch {
    void checkBridge(port);
  }
});

void init();


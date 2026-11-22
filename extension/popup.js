const DEFAULT_SETTINGS = {
  enabled: true,
  port: 49173,
  minSizeKb: 0,
  excludedDomains: [],
};

const statusPill = document.getElementById('status-pill');
const enabledToggle = document.getElementById('enabled-toggle');
const minSizeInput = document.getElementById('min-size-input');
const excludedInput = document.getElementById('excluded-domains-input');
const portInput = document.getElementById('port-input');
const focusBtn = document.getElementById('focus-btn');
const refreshBtn = document.getElementById('refresh-btn');
const saveHint = document.getElementById('save-hint');

let hintTimer = null;

function formatSpeed(bytes) {
  if (!bytes || bytes <= 0) return '0 B/s';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB/s`;
  return `${bytes} B/s`;
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
    statusPill.className = 'pill pill-ok';
    statusPill.textContent =
      data.activeCount > 0
        ? `Connected (${data.activeCount} · ${formatSpeed(data.totalDownloadSpeed)})`
        : 'Connected';
    focusBtn.disabled = false;
  } catch {
    statusPill.className = 'pill pill-off';
    statusPill.textContent = 'MyLoad offline';
    focusBtn.disabled = true;
  } finally {
    clearTimeout(timer);
  }
}

async function saveFromInputs() {
  const port = Math.min(65535, Math.max(1024, Number(portInput.value) || 49173));
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

async function init() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  enabledToggle.checked = Boolean(stored.enabled);
  portInput.value = String(Number(stored.port) || 49173);
  minSizeInput.value = String(Math.max(0, Number(stored.minSizeKb) || 0));
  excludedInput.value = Array.isArray(stored.excludedDomains)
    ? stored.excludedDomains.join('\n')
    : '';

  await checkBridge(Number(portInput.value) || 49173);
}

enabledToggle.addEventListener('change', () => void saveFromInputs());
minSizeInput.addEventListener('change', () => void saveFromInputs());
excludedInput.addEventListener('change', () => void saveFromInputs());
portInput.addEventListener('change', () => void saveFromInputs());

refreshBtn.addEventListener('click', () => {
  void checkBridge(Number(portInput.value) || 49173);
});

focusBtn.addEventListener('click', async () => {
  const port = Number(portInput.value) || 49173;
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


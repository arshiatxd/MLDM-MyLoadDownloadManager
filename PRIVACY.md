# MyLoad Privacy Policy

Effective Date: November 22, 2026

## 1. Local-First & Zero Telemetry
MyLoad runs completely locally on your device. It contains no analytics, tracking pixels, telemetry SDKs, or remote accounts, and never transmits your download history, filenames, or settings to external servers. Optional GitHub Release update checks query only the public `arshiatxd/MLDM-MyLoadDownloadManager` releases endpoint without sending any personal data and can be disabled in Preferences.

## 2. Local Storage
Your download queue, saved custom themes, preferences, and diagnostic logs are stored only on your computer under `%APPDATA%\MyLoad` (`state.json` and `logs/myload.log`). You can clear logs or remove items anytime from the UI.

## 3. Browser Extension & Authenticated Downloads
The optional Chromium extension communicates solely with MyLoad over your local loopback interface (`127.0.0.1`) and enforces extension-only origin checks. When intercepting a download from a signed-in website, cookies and referrer headers are passed strictly in memory to fetch that file, stripped automatically on cross-host redirects, never logged, and never persisted to disk.

## 4. Clipboard Recognition & Gaming / Surfing Mode
- **Clipboard Link Recognition** inspects clipboard text strictly locally in memory (when enabled in Settings) solely to pre-fill the URL field when you manually open **Add Download**. It never opens popups automatically, never logs clipboard contents to disk, and never transmits clipboard data over the network.
- **Gaming / Surfing Mode** performs lightweight TCP connect latency checks against `1.1.1.1` and `8.8.8.8` solely while enabled and actively downloading to detect latency spikes and balance bandwidth. No personal data is transmitted.

## 5. BitTorrent Networking
BitTorrent transfers connect directly to trackers, DHT, and peers as defined by the BitTorrent protocol, exposing your public IP address to other peers in the active swarm.

## 6. Multi-Part Scanning & Log Redaction
When **Multi-Part File Detection** is enabled in Settings, MyLoad only scans sequential numbered archive links on the same host and safe scheme as the requested download. The optional browser extension filters candidate links inside your active tab by same-origin hostname and archive filename patterns without reading unrelated page history. URL query tokens and credentials are automatically redacted before diagnostic logs are written to disk.

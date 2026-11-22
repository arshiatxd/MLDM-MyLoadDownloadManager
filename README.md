<div align="center">
  <img src="build/icon.png" alt="MyLoad Download Manager Logo" width="112" height="112" />
  <h1>MyLoad Download Manager</h1>
  <p><strong>Open-source, local-first HTTP/HTTPS &amp; BitTorrent download manager for Windows</strong></p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-crimson.svg" alt="License: MIT" /></a>
    <a href="#installation"><img src="https://img.shields.io/badge/Platform-Windows%20x64-blue.svg" alt="Platform: Windows x64" /></a>
    <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-45-47848F.svg" alt="Electron 45" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Strict-3178C6.svg" alt="TypeScript Strict" /></a>
  </p>
</div>

An open-source, local-first desktop download manager for **HTTP/HTTPS** files and **BitTorrent** magnets/`.torrent` files, built with Electron, React, TypeScript, and Tailwind CSS.

---

## Key Features

- **Multi-Segment HTTP/HTTPS Engine** — Range-based concurrent connections, automatic resume, duplicate handling (`Auto-rename`, `Overwrite`, `Ask`), and per-segment speed & byte tracking.
- **BitTorrent Support (WebTorrent)** — Download magnet links or local `.torrent` files with selective file picking inside the Inspector or Add Download modal.
- **Per-File-Type Download Folders** — Keep all downloads in one default folder or switch to category-specific folders (**Videos**, **Images**, **Documents**, **Archives**, **Torrents**, **Other Files**) with live disk-space validation.
- **Compact Download Frame & Auto-Download** — Browser interceptions open a compact floating frame instead of forcing the main window open, with an optional **Auto-download on click** toggle in Preferences.
- **Passive Clipboard Link Recognition** — Silently remembers your last copied downloadable link (`.zip`, `.rar`, `.exe`, `.mp4`, `magnet:?`, release assets, etc.) and auto-fills **Add Download** when opened manually.
- **Multi-Part Archive Scanner** — Detects split archives (`.part01.rar`, `.001`, `.r00`, `.z01`, etc.) and asks whether to queue all parts together (with `"Don't ask again"` settings control).
- **Flexible Batch Queues** — Queue multiple URLs or multi-part downloads in **Parallel**, **Sequential (Finish → Next)**, or **Equal Bandwidth Split** mode.
- **Gaming / Surfing Mode** — Continuously monitors RTT latency jitter and balances concurrency/speed limits to prevent lag spikes during online gaming, streaming, or browsing.
- **GitHub Update Notifier & One-Click Update** — Checks GitHub Releases for newer versions and lets you click **Update Now** to automatically download and launch the updated Windows installer.
- **Custom Theme Studio** — Switch between **Dark**, **Light**, or build and save your own custom palette using an interactive RGB/HSV wheel with live preview.
- **Startup & Power Management** — Toggle Windows auto-startup in Preferences, prevent system sleep during active downloads, and arm countdown power actions (**Shut down**, **Sleep**, **Hibernate**, or **Exit**).
- **Multilingual UI (9 Languages)** — English, Persian (RTL), Arabic (RTL), Spanish, French, German, Russian, Chinese, and Turkish, plus UI scale and Reduced Motion options.
- **Local-First Privacy & Hardened IPC** — Zero telemetry or remote servers. Read [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for architecture details.

---

## Installation

### Windows Installer Wizard (Recommended)

Download the latest `MyLoad-Download-Manager-Installer-1.0.14-x64.exe` from the [GitHub Releases](https://github.com/arshiatxd/MLDM-MyLoadDownloadManager/releases) page and follow the setup wizard (includes an optional Desktop shortcut toggle, automatic startup configuration, and automatic browser native-host registration). A standalone portable executable (`MyLoad-Download-Manager-Portable-1.0.14-x64.exe`) is also produced by `npm run dist`.

### Browser Extension & Localhost Bridge Guide

MyLoad Download Manager includes a Manifest V3 Chromium extension under [`extension/`](extension/) that forwards browser downloads, right-click **"Download with MyLoad"** actions, and media scans automatically over local loopback (`127.0.0.1`, ports `49173–49182`):

1. Open **Settings → General & Folders → Browser Integration** inside MyLoad Download Manager and click **Open Extension Folder** (or select this repository's `extension/` directory).
2. Open `chrome://extensions` or `edge://extensions` in your browser and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.

#### How Automatic Bridge & Auto-Launch Work
- **Zero manual port setup:** MyLoad automatically binds `127.0.0.1:49173` (falling back through `49174–49182` if busy), and the browser extension discovers the live port automatically.
- **Auto-launch when closed:** Installing or launching MyLoad registers the `com.myload.host` Native Messaging host (`%LOCALAPPDATA%\MyLoad\native-host\com.myload.host.json`). When MyLoad is completely closed and you click a download link or choose **Download with MyLoad**, the extension wakes MyLoad in the background and opens the confirmation popup directly in front of your browser.

#### Troubleshooting (Manual Setup if Needed)
- If the extension popup shows **MyLoad offline** even while MyLoad is running, verify **Settings → General & Folders → Enable local browser extension bridge** is checked and matches the port inside the extension's **Advanced bridge port** section (`49173` by default).
- After updating extension files, click the **Reload** icon on `chrome://extensions` / `edge://extensions` so the updated extension ID (`cbnkknogojpgeikfeaploefenabcgiai`) and `nativeMessaging` permission take effect.

---

## Documentation

- [Privacy Policy](PRIVACY.md)
- [Security Policy](SECURITY.md)
- [Contributing Guide](CONTRIBUTING.md)
- [MIT License](LICENSE)

---

## License

Licensed under the [MIT License](LICENSE) © 2026 arshiatxd & MyLoad Download Manager Contributors.

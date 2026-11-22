# MyLoad (MLDM — MyLoad Download Manager)

[![License: MIT](https://img.shields.io/badge/License-MIT-crimson.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-blue.svg)](#installation)
[![Electron](https://img.shields.io/badge/Electron-45-47848F.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6.svg)](https://www.typescriptlang.org/)

An open-source, local-first desktop download manager for **HTTP/HTTPS** files and **BitTorrent** magnets/`.torrent` files, built with Electron, React, TypeScript, and Tailwind CSS.

Repository: <https://github.com/arshiatxd/MLDM-MyLoadDownloadManager>

---

## Key Features

- **Multi-Segment HTTP/HTTPS Engine** — Range-based concurrent connections, automatic resume, duplicate handling (`Auto-rename`, `Overwrite`, `Ask`), and per-segment speed & byte tracking.
- **BitTorrent Support (WebTorrent)** — Download magnet links or local `.torrent` files with selective file picking inside the Inspector or Add Download modal.
- **Compact Download Frame & Auto-Download** — Interceptions from your browser open a sleek compact floating frame instead of forcing the full main window open, with an optional **Auto-download on click** mode in Settings.
- **Passive Clipboard Link Recognition** — Silently remembers your last copied downloadable link (`.zip`, `.rar`, `.exe`, `.mp4`, `magnet:?`, release assets, etc.) and automatically pre-fills **Add Download** when you open it manually — never triggers surprise popups when copying links.
- **Multi-Part Archive Scanner** — Automatically detects split archives (`.part01.rar`, `.001`, `.r00`, `.z01`, etc.) and asks whether to queue all parts together (with `"Don't ask again"` settings control).
- **Flexible Batch Queues** — Add multiple URLs or multi-part downloads using **Parallel**, **Sequential (Finish → Next)**, or **Equal Bandwidth Split** queue modes.
- **Gaming / Surfing Mode** — Dynamically measures network RTT jitter and balances segment concurrency and rate limits to prevent lag spikes during online gaming, streaming, or browsing.
- **Custom Theme Studio** — Switch between **Dark**, **Light**, or build and save your own custom color palette with an interactive RGB/HSV wheel and live preview.
- **Power & Sleep Management** — Automatically prevent system sleep while downloads run and schedule optional countdown actions (**Shut down**, **Sleep**, **Hibernate**, or **Exit MyLoad**).
- **Multilingual UI (9 Languages)** — Includes full English, Persian (RTL), Arabic (RTL), Spanish, French, German, Russian, Chinese, and Turkish support, plus adjustable UI text scale and Reduced Motion mode.
- **Local-First Privacy & Hardened IPC** — Zero telemetry or remote servers. Read [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for architecture details.

---

## Installation

### Windows Installer Wizard (Recommended)

Download the latest `MyLoad-Installer-1.0.0-x64.exe` from the [GitHub Releases](https://github.com/arshiatxd/MLDM-MyLoadDownloadManager/releases) page and follow the setup wizard. A standalone portable executable (`MyLoad-Portable-1.0.0-x64.exe`) is also supported by the build configuration.

### Companion Browser Extension (Chrome / Edge / Brave)

MyLoad includes a Manifest V3 Chromium extension under [`extension/`](extension/) that forwards browser download clicks and right-click context actions over local loopback (`127.0.0.1:49173`):

1. Open **Settings → General & Folders → Browser Integration** inside MyLoad and click **Open Extension Folder** (or use this repository's `extension/` directory).
2. Open `chrome://extensions` or `edge://extensions` in your browser and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.

---

## Building from Source

### Prerequisites

- **Node.js** `20+` (and `npm`)
- **Windows 10/11 x64** (for NSIS & portable Windows installer packaging)

### Development & Verification Commands

```powershell
# Install dependencies
npm install

# Run in development mode (Vite + Electron hot watch)
npm run dev

# Typecheck main, preload, shared, and renderer
npm run typecheck

# Run unit & integration tests (Vitest)
npm test

# Build production bundles without packaging
npm run build

# Build Windows Installer Wizard & Portable EXE into release/
npm run dist
```

---

## Documentation

- [Privacy Policy](PRIVACY.md)
- [Security Policy](SECURITY.md)
- [Contributing Guide](CONTRIBUTING.md)
- [MIT License](LICENSE)

---

## License

Licensed under the [MIT License](LICENSE) © 2026 arshiatxd & MyLoad Contributors.

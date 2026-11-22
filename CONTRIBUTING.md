# Contributing to MyLoad

Thank you for contributing to **MyLoad (MLDM — MyLoad Download Manager)**!

Repository: <https://github.com/arshiatxd/MLDM-MyLoadDownloadManager>

## Local Setup

1. Clone the repository and install dependencies:
   ```powershell
   git clone https://github.com/arshiatxd/MLDM-MyLoadDownloadManager.git
   cd MLDM-MyLoadDownloadManager
   npm install
   ```
2. Start the development environment:
   ```powershell
   npm run dev
   ```

## Checks Required Before Opening a Pull Request

Run both checks and confirm everything passes with zero errors:

```powershell
npm run typecheck
npm test
```

If your changes touch Electron main process startup, `electron-builder.yml`, or packaged dependencies (such as `webtorrent`), also verify the packaged build:

```powershell
npm run dist
```

## Architecture & Review Guidelines

- **Local-First & Zero Telemetry:** Do not introduce analytics, external phone-home calls, remote update telemetry, or third-party tracking.
- **IPC & Navigation Safety:** Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` enabled across all `BrowserWindow` instances. Never pass unvalidated filesystem paths into `shell.openPath` / `shell.showItemInFolder` or write session cookies/auth query tokens to disk or logs.
- **Clean Code:** Keep code modular, typed strictly in TypeScript (`noImplicitAny`, `strict: true`), and covered by Vitest unit tests under `tests/`.
- **Keep Dependencies Lean:** Check packaged bundle impact (`electron-builder.yml` / `scripts/after-pack.mjs`) before adding heavy runtime dependencies.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

# Security Policy

## Reporting a Vulnerability

If you discover a security or privacy vulnerability in **MyLoad**, please report it responsibly via GitHub Security Advisories:

- <https://github.com/arshiatxd/MLDM-MyLoadDownloadManager/security/advisories/new>

If private advisory reporting is unavailable for your account, please open an issue without publishing exploit payloads so maintainers can coordinate a fix first.

## Security Architecture Summary

MyLoad is designed to keep downloads, session credentials, and local files isolated:

- **Process Isolation & CSP:** All Electron renderers run with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, blocked `will-attach-webview`, strict `will-navigate` guards, denied permission requests, and a strict production `Content-Security-Policy`.
- **Loopback Browser Bridge (`127.0.0.1`):** The local HTTP bridge binds strictly to `127.0.0.1` and accepts requests only from `chrome-extension://` or `edge-extension://` origins with bounded JSON body sizes.
- **Ephemeral Session Headers:** Cookies and referrer headers captured for authenticated browser downloads are sanitized against CRLF injection, stored strictly in memory for the active transfer, stripped automatically across cross-host redirects or HTTPS-to-HTTP downgrades, and stripped before any download state is persisted or cloned to renderers.
- **Path & Filename Safety:** File names are sanitized against traversal, illegal NTFS characters, Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`), and path length limits. Torrent targets verify path containment (`isPathInsideDir`), and IPC file-open handlers allowlist only known managed download paths.
- **Diagnostic Log Redaction:** Sensitive query parameters (tokens, signatures, keys) and URL credentials are masked before logs reach memory buffers or `myload.log`.

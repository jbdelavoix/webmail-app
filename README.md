# Mail

Desktop client for juggling **multiple webmail accounts in a single window**, built with [Electron](https://www.electronjs.org/).

The user-facing product name is **Mail** (`productName` in [`package.json`](package.json)); the npm package in this repo is **webmail-app**.

## Features

- **Multiple accounts** with a sidebar switcher and **isolated** Chromium storage per `<webview>` partition.
- **Presets**: Gmail, Outlook (Microsoft 365), iCloud Mail, Yahoo Mail — plus arbitrary URLs for custom icons (Iconify ids).
- **Per-account settings** (display name, URL override, colour, delete).
- **Light / dark shell** aligned with system `prefers-color-scheme` (CDN-free: bundled Tailwind + local Iconify runtime).
- **Internationalization**: `en`, `de`, `fr`, `es` JSON packs under [`src/locales/`](src/locales/). Detection uses Electron’s **`getPreferredSystemLanguages()`** plus **`app.getLocale()`**, with **English fallback** for anything else.
- **Language override**: in **Settings → Language**, choose *system* or force a locale; preference is saved in `preferences.json` under the OS user-data folder for the app, and windows reload automatically.
- **macOS**: `hiddenInset` title bar; Dock / window raster icons; Dock badge estimating **aggregate** unread count when providers put counts in tab titles (**heuristic**, not universal across webmails).

**Not shipped:** OS-level push notifications for new mail — only the heuristic Dock badge applies.

## Requirements

- [Node.js](https://nodejs.org/) (recommended: current **LTS**)
- npm

## Development

```bash
npm install   # runs prepare → copies Iconify + builds Tailwind into src/vendor/
npm test
npm start
```

| Path | Role |
|------|------|
| [`src/main.js`](src/main.js) | Main process |
| [`src/app.html`](src/app.html), [`src/app.js`](src/app.js) | Renderer UI |
| [`src/preload.js`](src/preload.js) | Preload bridge (IPC whitelist) |
| [`src/vendor/tailwind.css`](src/vendor/tailwind.css) | Compiled utilities (run `npm run build:css` after class changes if you skipped `prepare`) |
| [`src/vendor/iconify.min.js`](src/vendor/iconify.min.js) | Bundled Iconify loader |
| [`src/style.css`](src/style.css) | Extra injected chrome styles |

After editing Tailwind class names in HTML/JS, refresh assets with **`npm run build:css`** (or **`npm run vendor:sync`**, which also recopies Iconify).

## Building for distribution

Scripts use [electron-builder](https://www.electron.build/), matching the `build` block in [`package.json`](package.json):

- **`npm run dist`** / **`npm run dist:mac`** — macOS (universal, per config)
- **`npm run dist:win`** — Windows (NSIS + zip targets in config)
- **`npm run dist:linux`** — Linux (AppImage, deb, rpm, etc.)

Bundled branding: [`build/`](build/) (`.icns` on macOS, `build/icons/*.png` for Dock / raster window icons). On macOS only, `.icns` is preferred for `BrowserWindow` when present.

Windows builds set **`verifyUpdateCodeSignature`** to **`false`** in packager config — turn this **on** and sign installers when you ship signed releases so auto-update tooling can enforce signatures.

### Google login User-Agent tweak

After **`app.whenReady()`**, the default session attaches a **`webRequest`** listener that uses a **Firefox-style User-Agent** for **`accounts.google.com`**, to reduce “unsupported browser” behaviour in Electron mail shells (discussion context: [timche/gmail-desktop#174](https://github.com/timche/gmail-desktop/issues/174)).

External windows opened via `window.open` are only honoured for **`http:`** / **`https:`** URLs before loading in-place.

## Security notes (webview model)

Keeping **`nodeIntegration: false`** + **`contextIsolation: true`** in the renderer is intentional. Embedded mail UIs remain third-party code — treat credential hygiene like a normal browser (password manager / screen lock).

## Downloads

Artifacts (if published) appear on **[Releases — latest](https://github.com/jbdelavoix/webmail-app/releases/latest)** (see [`homepage`](https://github.com/jbdelavoix/webmail-app) in `package.json`).

## Testing

Automated **`node:test`** suites live under [`test/`](test/). Today this includes [`test/i18n.test.js`](test/i18n.test.js) exercising [`src/i18n.js`](src/i18n.js). Run:

```bash
npm test
```

(Add more files with the `*.test.js` naming convention and extend the `test` script in `package.json` if you introduce additional suites.)

## License

**MIT** — see [`LICENSE`](LICENSE).

## Maintainer

- [jbdelavoix](https://github.com/jbdelavoix)

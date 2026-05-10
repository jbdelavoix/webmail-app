const {
  app,
  ipcMain,
  session,
  BrowserWindow,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
} = require("electron");
const fs = require("fs");
const path = require("path");

const PACKAGE = require("../package.json");

const HOMEPAGE =
  typeof PACKAGE.homepage === "string"
    ? PACKAGE.homepage
    : "https://github.com/jbdelavoix/webmail-app";

const {
  resolvePreferredLocale,
  loadMessages,
  lookup,
  SUPPORTED,
} = require("./i18n");
const { loadPrefs, savePrefs } = require("./preferences");

let resolvedLocale = "en";
let uiMessages = loadMessages("en");
let englishMessages = uiMessages;

function tl(key) {
  return lookup(uiMessages, key) ?? lookup(englishMessages, key) ?? key;
}

function applyResolvedLocale(locale) {
  resolvedLocale = locale;
  uiMessages = loadMessages(resolvedLocale);
  englishMessages =
    resolvedLocale === "en" ? uiMessages : loadMessages("en");
}

function effectiveUiLocale(app, preference) {
  const mode =
    preference === undefined || preference === null
      ? "system"
      : String(preference);
  if (mode !== "system" && SUPPORTED.has(mode)) return mode;
  return resolvePreferredLocale(app);
}

ipcMain.on("i18n:get-bundle", (event) => {
  event.returnValue = {
    locale: resolvedLocale,
    messages: uiMessages,
    fallback: resolvedLocale === "en" ? null : englishMessages,
  };
});

let mainWindow = null;

const BUILD_ASSETS = path.join(__dirname, "..", "build");

function rasterIconDir() {
  return path.join(BUILD_ASSETS, "icons");
}

function loadBundledIconImage(candidatePath) {
  if (
    typeof candidatePath !== "string" ||
    candidatePath.length === 0 ||
    !fs.existsSync(candidatePath)
  ) {
    return null;
  }
  try {
    const img = nativeImage.createFromPath(candidatePath);
    return img.isEmpty() ? null : img;
  } catch {
    return null;
  }
}

/** Icons loadable by BrowserWindow (PNG preferred — some .icns variants throw at runtime). */
function bundledWindowIconCandidates() {
  const isDark = nativeTheme.shouldUseDarkColors;
  const rasterDir = rasterIconDir();
  const pngThemed = path.join(rasterDir, isDark ? "icon-dark.png" : "icon.png");
  const pngLight = path.join(rasterDir, "icon.png");
  const pngDark = path.join(rasterDir, "icon-dark.png");

  /** @type {string[]} */
  const ordered = [pngThemed];

  if (pngThemed !== pngLight) ordered.push(pngLight);
  if (pngThemed !== pngDark && pngLight !== pngDark) ordered.push(pngDark);

  if (process.platform === "darwin") {
    ordered.push(path.join(BUILD_ASSETS, isDark ? "icon-dark.icns" : "icon.icns"));
    ordered.push(path.join(BUILD_ASSETS, "icon.icns"));
  } else if (process.platform === "win32") {
    ordered.push(path.join(BUILD_ASSETS, "icon.ico"));
  }

  const seen = new Set();
  return ordered.filter((p) => {
    if (!p || seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}

function getBundledWindowIconImage() {
  for (const candidate of bundledWindowIconCandidates()) {
    const img = loadBundledIconImage(candidate);
    if (img !== null) return img;
  }
  return null;
}

function dockIconImageCandidates() {
  const isDark = nativeTheme.shouldUseDarkColors;
  const rasterDir = rasterIconDir();
  const pngThemed = path.join(rasterDir, isDark ? "icon-dark.png" : "icon.png");
  const pngFallback = path.join(rasterDir, "icon.png");
  const pngDarkFallback = path.join(rasterDir, "icon-dark.png");

  /** @type {string[]} */
  const ordered = [pngThemed];
  if (pngThemed !== pngFallback) ordered.push(pngFallback);
  if (pngFallback !== pngDarkFallback) ordered.push(pngDarkFallback);

  const seen = new Set();
  return ordered.filter((p) => {
    if (!p || seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}

function getDockIconImage() {
  for (const candidate of dockIconImageCandidates()) {
    const img = loadBundledIconImage(candidate);
    if (img !== null) return img;
  }
  return null;
}

function addMenu(platform) {
  const menu = Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: tl("menu.learnMore"),
          click: () => shell.openExternal(HOMEPAGE).catch(() => {}),
        },
      ],
    },
  ]);

  if (platform === "darwin") {
    Menu.setApplicationMenu(menu);
  } else {
    Menu.setApplicationMenu(null);
  }
}

function updateDockIcon() {
  try {
    if (process.platform === "darwin" && app.dock) {
      const dockImg = getDockIconImage();
      if (dockImg !== null) app.dock.setIcon(dockImg);
    }
  } catch {
    // ignore malformed / unreadable raster assets (dev sandboxes, bad exports, etc.)
  }

  try {
    if (mainWindow) {
      const winImg = getBundledWindowIconImage();
      if (winImg !== null) mainWindow.setIcon(winImg);
    }
  } catch {
    // ignore
  }
}

function configureAccountsGoogleUserAgent() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = new URL(details.url);
    if (url.hostname === "accounts.google.com") {
      details.requestHeaders["User-Agent"] =
        "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0";
    }
    callback({
      cancel: false,
      requestHeaders: details.requestHeaders,
    });
  });
}

function normalizeAppearancePreference(raw) {
  const s = raw === undefined || raw === null ? "system" : String(raw);
  if (s === "light" || s === "dark" || s === "system") return s;
  return "system";
}

function normalizeTabBarPosition(raw) {
  const s = raw === undefined || raw === null ? "top" : String(raw);
  if (s === "side" || s === "top") return s;
  return "top";
}

function syncNativeAppearance(mode) {
  const normalized = normalizeAppearancePreference(mode);
  try {
    if (normalized === "dark") nativeTheme.themeSource = "dark";
    else if (normalized === "light") nativeTheme.themeSource = "light";
    else nativeTheme.themeSource = "system";
  } catch {
    // ignore
  }
}

function setupPreferencesIpc() {
  ipcMain.handle("prefs:getUiLocale", () => {
    const p = loadPrefs(app);
    const raw = p.uiLocale;
    if (raw === undefined || raw === null) return "system";
    const s = String(raw);
    if (s === "system" || SUPPORTED.has(s)) return s;
    return "system";
  });

  ipcMain.handle("prefs:getAppearance", () => {
    return normalizeAppearancePreference(loadPrefs(app).uiAppearance);
  });

  ipcMain.handle("prefs:setAppearance", async (_event, requested) => {
    const normalized = normalizeAppearancePreference(requested);
    savePrefs(app, { ...loadPrefs(app), uiAppearance: normalized });
    syncNativeAppearance(normalized);
    return { saved: normalized };
  });

  ipcMain.handle("prefs:getTabBarPosition", () => {
    return normalizeTabBarPosition(loadPrefs(app).uiTabBarPosition);
  });

  ipcMain.handle("prefs:setTabBarPosition", async (_event, requested) => {
    const normalized = normalizeTabBarPosition(requested);
    savePrefs(app, { ...loadPrefs(app), uiTabBarPosition: normalized });
    return { saved: normalized };
  });

  ipcMain.handle("prefs:setUiLocale", async (_event, requested) => {
    const normalized =
      requested === "system"
        ? "system"
        : SUPPORTED.has(requested)
          ? requested
          : "system";
    savePrefs(app, { ...loadPrefs(app), uiLocale: normalized });

    applyResolvedLocale(effectiveUiLocale(app, normalized));
    addMenu(process.platform);

    for (const win of BrowserWindow.getAllWindows()) {
      if (typeof win.webContents.reloadIgnoringCache === "function") {
        win.webContents.reloadIgnoringCache();
      } else {
        win.webContents.reload();
      }
    }

    return { saved: normalized };
  });
}

function setupMailIpc() {
  ipcMain.on("unread-mails:count", function (_event, unreadMails) {
    if (!app.dock) return;
    if (unreadMails !== 0) {
      app.dock.setBadge(String(unreadMails));
    } else {
      app.dock.setBadge("");
    }
  });

  ipcMain.on("contextmenu:open", function (_event, x, y) {
    const ctx = Menu.buildFromTemplate([
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { type: "separator" },
      {
        label: tl("menu.advanced"),
        submenu: [{ role: "reload" }, { role: "toggleDevTools" }],
      },
    ]);
    ctx.popup({
      window: mainWindow ?? undefined,
      x,
      y,
    });
  });
}

function createWindow() {
  updateDockIcon();

  const darwinChrome =
    process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {};

  const browserIcon = getBundledWindowIconImage();

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    ...darwinChrome,
    icon: browserIcon ?? undefined,
    webPreferences: {
      webviewTag: true,
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on("dom-ready", () => {
    mainWindow.webContents.insertCSS(
      fs.readFileSync(path.join(__dirname, "style.css"), "utf8"),
    );
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol === "http:" ||
        parsed.protocol === "https:"
      ) {
        mainWindow.loadURL(parsed.toString());
      }
    } catch {
      // ignore malformed URLs / schemes
    }
    return { action: "deny" };
  });

  mainWindow.on("close", (event) => {
    if (process.platform === "darwin") {
      event.preventDefault();
      mainWindow.hide();
    } else {
      mainWindow = null;
    }
  });

  mainWindow.loadFile(path.join(__dirname, "app.html"));
}

let didRegisterNativeThemeWatch = false;

function ensureDockIconTracksTheme() {
  if (didRegisterNativeThemeWatch) return;
  didRegisterNativeThemeWatch = true;
  nativeTheme.on("updated", () => updateDockIcon());
}

ensureDockIconTracksTheme();

app.whenReady().then(() => {
  const prefsData = loadPrefs(app);
  applyResolvedLocale(effectiveUiLocale(app, prefsData.uiLocale));
  syncNativeAppearance(prefsData.uiAppearance);

  configureAccountsGoogleUserAgent();

  setupPreferencesIpc();
  setupMailIpc();

  addMenu(process.platform);

  createWindow();

  app.on("activate", () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

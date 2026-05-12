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

/** macOS: distinguish red-close (hide) from real quit (Cmd+Q / menu Quit). */
let isAppQuitting = false;

app.on("before-quit", () => {
  isAppQuitting = true;
});

const BUILD_ASSETS = path.join(__dirname, "..", "build");

/**
 * Window / Dock raster used only in development (`electron .`).
 * Packaged apps rely on `CFBundleIconName` / Assets.car — avoid overriding Dock.
 */
function loadDevIconImage() {
  const candidates = [
    path.join(BUILD_ASSETS, "icons", "icon.png"),
    process.platform === "darwin" ? path.join(BUILD_ASSETS, "icon.icns") : null,
    process.platform === "win32" ? path.join(BUILD_ASSETS, "icon.ico") : null,
  ].filter((p) => typeof p === "string");

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    } catch {
      // ignore
    }
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
    const advancedSubmenu = [{ role: "reload" }];
    if (!app.isPackaged) {
      advancedSubmenu.push({ role: "toggleDevTools" });
    }
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
        submenu: advancedSubmenu,
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
  const devIcon = app.isPackaged ? null : loadDevIconImage();

  const darwinChrome =
    process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {};

  mainWindow = new BrowserWindow({
    title: typeof PACKAGE.productName === "string" ? PACKAGE.productName : "Webmail",
    width: 1600,
    height: 900,
    ...darwinChrome,
    icon: devIcon ?? undefined,
    webPreferences: {
      webviewTag: true,
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged && process.platform === "darwin" && app.dock && devIcon) {
    try {
      app.dock.setIcon(devIcon);
    } catch {
      // ignore
    }
  }

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
    if (process.platform === "darwin" && !isAppQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, "app.html"));
}

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

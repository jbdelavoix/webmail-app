const { contextBridge, ipcRenderer } = require("electron");

function pathLookup(root, dottedPath) {
  if (!root || !dottedPath) return undefined;
  let cur = root;
  for (const segment of dottedPath.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[segment];
  }
  return typeof cur === "string" ? cur : undefined;
}

function applyReplacements(str, replacements) {
  if (
    replacements == null ||
    typeof replacements !== "object"
  )
    return str;
  let out = str;
  for (const key of Object.keys(replacements)) {
    out = out.split(`{${key}}`).join(String(replacements[key]));
  }
  return out;
}

const bundle = ipcRenderer.sendSync("i18n:get-bundle");

function translate(pathKey, replacements) {
  let resolved = pathLookup(bundle.messages, pathKey);
  if (typeof resolved !== "string") {
    resolved = bundle.fallback
      ? pathLookup(bundle.fallback, pathKey)
      : undefined;
  }
  if (typeof resolved !== "string") resolved = pathKey;
  return applyReplacements(resolved, replacements);
}

contextBridge.exposeInMainWorld("electronAPI", {
  locale: bundle.locale,

  /** Win32 | darwin | linux — chrome layout only */
  platform: process.platform,

  t(pathKey, replacements) {
    return translate(pathKey, replacements);
  },

  getUiLocalePreference() {
    return ipcRenderer.invoke("prefs:getUiLocale");
  },

  setUiLocalePreference(mode) {
    return ipcRenderer.invoke("prefs:setUiLocale", mode);
  },

  getAppearancePreference() {
    return ipcRenderer.invoke("prefs:getAppearance");
  },

  setAppearancePreference(mode) {
    return ipcRenderer.invoke("prefs:setAppearance", mode);
  },

  getTabBarPositionPreference() {
    return ipcRenderer.invoke("prefs:getTabBarPosition");
  },

  setTabBarPositionPreference(mode) {
    return ipcRenderer.invoke("prefs:setTabBarPosition", mode);
  },

  sendUnreadCount(count) {
    ipcRenderer.send("unread-mails:count", count);
  },

  openContextMenu(x, y) {
    ipcRenderer.send("contextmenu:open", x, y);
  },
});

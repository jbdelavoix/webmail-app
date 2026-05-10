const fs = require("fs");
const path = require("path");

const SUPPORTED = new Set(["en", "de", "fr", "es"]);

function normalizePrimaryLanguageTag(tag) {
  return (
    String(tag || "")
      .replace(/_/g, "-")
      .toLowerCase()
      .split("-")[0] || ""
  );
}

/** Map a locale string such as fr_FR or fr-FR to supported code or fallback en */
function resolveLocale(osLocale) {
  const lang = normalizePrimaryLanguageTag(osLocale || "en");
  if (SUPPORTED.has(lang)) return lang;
  return "en";
}

/**
 * Match macOS / Windows preferred UI languages (Electron) then app.getLocale().
 * @param {import("electron").App} electronApp
 */
function resolvePreferredLocale(electronApp) {
  let ordered = [];

  if (typeof electronApp.getPreferredSystemLanguages === "function") {
    try {
      ordered = electronApp.getPreferredSystemLanguages() || [];
    } catch {
      ordered = [];
    }
  }

  for (const tag of ordered) {
    const lang = normalizePrimaryLanguageTag(tag);
    if (lang && SUPPORTED.has(lang)) return lang;
  }

  return resolveLocale(electronApp.getLocale());
}

function loadMessages(locale) {
  const dir = path.join(__dirname, "locales");

  try {
    return JSON.parse(
      fs.readFileSync(path.join(dir, `${locale}.json`), "utf8"),
    );
  } catch {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(dir, "en.json"), "utf8"),
      );
    } catch {
      return {};
    }
  }
}

/** @param {object} messages @param {string} dotted e.g. "settings.title" */
function lookup(messages, dotted) {
  if (!messages || !dotted) return undefined;

  let cur = messages;
  for (const segment of dotted.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[segment];
  }
  return typeof cur === "string" ? cur : undefined;
}

module.exports = {
  SUPPORTED,
  normalizePrimaryLanguageTag,
  resolveLocale,
  resolvePreferredLocale,
  loadMessages,
  lookup,
};

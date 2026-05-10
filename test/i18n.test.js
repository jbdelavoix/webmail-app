"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  normalizePrimaryLanguageTag,
  resolveLocale,
  resolvePreferredLocale,
  SUPPORTED,
} = require("../src/i18n.js");

test("normalizePrimaryLanguageTag normalizes tags", () => {
  assert.strictEqual(normalizePrimaryLanguageTag("fr_FR"), "fr");
  assert.strictEqual(normalizePrimaryLanguageTag("pt-BR"), "pt");
  assert.strictEqual(normalizePrimaryLanguageTag(""), "");
});

test("resolveLocale respects supported subset", () => {
  assert.strictEqual(resolveLocale("fr"), "fr");
  assert.strictEqual(resolveLocale("FR-ca"), "fr");
  assert.strictEqual(resolveLocale("pt"), "en");
});

test("SUPPORTED exposes expected locales", () => {
  assert.deepStrictEqual(
    [...SUPPORTED].sort(),
    ["de", "en", "es", "fr"],
  );
});

test("resolvePreferredLocale walks Electron language list first", () => {
  const app = {
    getPreferredSystemLanguages() {
      return ["pt-BR", "fr-CA"];
    },
    getLocale() {
      return "en-US";
    },
  };

  assert.strictEqual(resolvePreferredLocale(app), "fr");

  const appGermanFirst = {
    getPreferredSystemLanguages() {
      return ["de-DE"];
    },
    getLocale() {
      return "en-US";
    },
  };

  assert.strictEqual(resolvePreferredLocale(appGermanFirst), "de");
});

test("resolvePreferredLocale falls back to getLocale", () => {
  const stub = {
    getPreferredSystemLanguages() {
      return ["pt"];
    },
    getLocale() {
      return "es-MX";
    },
  };

  assert.strictEqual(resolvePreferredLocale(stub), "es");
});

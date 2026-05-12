"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { loadPrefs, savePrefs } = require("../src/preferences.js");

function mockApp(userDataDir) {
  return {
    getPath(name) {
      if (name === "userData") return userDataDir;
      throw new Error(`unexpected getPath(${name})`);
    },
  };
}

test("loadPrefs returns {} when file is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webmail-prefs-"));
  const app = mockApp(dir);
  assert.deepStrictEqual(loadPrefs(app), {});
});

test("loadPrefs returns {} for invalid JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webmail-prefs-"));
  const app = mockApp(dir);
  fs.writeFileSync(path.join(dir, "preferences.json"), "not json {", "utf8");
  assert.deepStrictEqual(loadPrefs(app), {});
});

test("savePrefs and loadPrefs round-trip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webmail-prefs-"));
  const app = mockApp(dir);
  const data = { uiAppearance: "dark", uiLocale: "fr" };
  savePrefs(app, data);
  assert.deepStrictEqual(loadPrefs(app), data);
});

const fs = require("fs");
const path = require("path");

function filePath(app) {
  return path.join(app.getPath("userData"), "preferences.json");
}

function loadPrefs(app) {
  try {
    const raw = fs.readFileSync(filePath(app), "utf8");
    const data = JSON.parse(raw);
    return data != null && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function savePrefs(app, data) {
  const target = filePath(app);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(data, null, 2), "utf8");
}

module.exports = {
  loadPrefs,
  savePrefs,
};

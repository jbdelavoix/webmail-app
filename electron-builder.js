"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const iconComposerPath = path.join(__dirname, "build", "icon.icon");

/** Apple Icon Composer (`.icon`) needs actool 26+; older Xcode / CI runners ship lower. */
function actoolMajorVersion() {
  if (process.platform !== "darwin") return 0;
  try {
    const out = execSync("xcrun actool --version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 8000,
    });
    const m = String(out).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

const ACTOOL_MIN_FOR_ICON_COMPOSER = 26;
const macIcon =
  fs.existsSync(iconComposerPath) &&
  actoolMajorVersion() >= ACTOOL_MIN_FOR_ICON_COMPOSER
    ? "build/icon.icon"
    : "build/icon.icns";

/** @type {import("electron-builder").Configuration} */
module.exports = {
  artifactName: "${name}-${version}-${os}.${ext}",
  files: ["**/*", "build/**/*"],
  appId: "jbdelavoix.webmail-app",
  mac: {
    icon: macIcon,
    target: {
      target: "default",
      arch: "universal",
    },
    category: "public.app-category.productivity",
    darkModeSupport: true,
  },
  dmg: {
    icon: "build/icon.icns",
  },
  linux: {
    icon: "build/icons/icon.png",
    target: ["AppImage", "deb", "rpm", "tar.bz2"],
    category: "Network;Office",
  },
  win: {
    icon: "build/icon.ico",
    verifyUpdateCodeSignature: false,
    target: ["nsis", "zip"],
  },
};

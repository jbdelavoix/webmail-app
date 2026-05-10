"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const vendorDir = path.join(root, "src", "vendor");
const iconSrc = path.join(
  root,
  "node_modules",
  "@iconify",
  "iconify",
  "dist",
  "iconify.min.js",
);
const iconDest = path.join(vendorDir, "iconify.min.js");

fs.mkdirSync(vendorDir, { recursive: true });

if (!fs.existsSync(iconSrc)) {
  console.warn(
    "sync-vendor-assets: Iconify bundle not found (run npm install).",
  );
  process.exit(0);
}

fs.copyFileSync(iconSrc, iconDest);
console.warn("Copied Iconify bundle to src/vendor/iconify.min.js.");

try {
  execSync(
    "npx --no-install tailwindcss -i ./src/styles/tailwind-input.css -o ./src/vendor/tailwind.css --minify",
    { cwd: root, stdio: "inherit" },
  );
  console.warn("Built src/vendor/tailwind.css.");
} catch {
  console.warn(
    "sync-vendor-assets: tailwind build failed — run npm run build:css manually.",
  );
}

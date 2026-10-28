/**
 * electron-builder 25 bundles a dmgbuild version whose background bookmark makes
 * Finder ignore the background on macOS 26.2+. Keep the image alias, omit pBBk.
 * Upstream fix: https://github.com/dmgbuild/dmgbuild/pull/275
 * Run before packaging; no Finder automation or additional dependencies needed.
 */
const fs = require("node:fs");
const path = require("node:path");

if (process.platform === "darwin") {
  const vendor = require("dmg-builder/out/dmgUtil").getDmgVendorPath();
  const filename = path.join(vendor, "dmgbuild/core.py");
  const source = fs.readFileSync(filename, "utf8");
  const bookmark = "          d['.']['pBBk'] = background_bmk";
  const legacy = `        if background_bmk:\n${bookmark}\n`;

  if (source.includes(bookmark)) {
    if (!source.includes(legacy)) {
      throw new Error(
        "Unrecognized dmgbuild background code; review the macOS 26 compatibility patch.",
      );
    }
    fs.writeFileSync(filename, source.replace(legacy, ""));
    console.log("[patch] Applied dmgbuild background fix for macOS 26.2+");
  }
}

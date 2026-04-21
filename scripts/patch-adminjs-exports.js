/**
 * Patches @adminjs/design-system package.json to add missing "require" condition
 * to the "./styled-components" export. Without this, tsx (CJS mode) cannot resolve
 * the subpath and throws ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 * This runs as a postinstall hook.
 */
const fs = require("fs");
const path = require("path");

const locations = [
  "node_modules/@adminjs/design-system/package.json",
  "node_modules/adminjs/node_modules/@adminjs/design-system/package.json",
  "apps/core-backend/node_modules/@adminjs/design-system/package.json",
];

let patched = 0;

for (const rel of locations) {
  const abs = path.resolve(__dirname, "..", rel);
  if (!fs.existsSync(abs)) continue;

  const pkg = JSON.parse(fs.readFileSync(abs, "utf8"));
  const sc = pkg.exports?.["./styled-components"];
  if (sc && !sc.require) {
    sc.require = sc.import;
    fs.writeFileSync(abs, JSON.stringify(pkg, null, 2) + "\n");
    patched++;
  }
}

if (patched > 0) {
  console.log(`[patch] Added "require" export to @adminjs/design-system in ${patched} location(s)`);
}

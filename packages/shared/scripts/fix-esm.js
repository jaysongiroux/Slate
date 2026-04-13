const fs = require("fs");
const path = require("path");

const esmDir = path.join(__dirname, "..", "dist", "esm");

// Drop in package.json so Node treats .js files as ESM
fs.writeFileSync(path.join(esmDir, "package.json"), '{ "type": "module" }\n');

// Add .js extensions to relative imports (TypeScript omits them)
for (const file of fs.readdirSync(esmDir).filter((f) => f.endsWith(".js"))) {
  const filePath = path.join(esmDir, file);
  let content = fs.readFileSync(filePath, "utf8");
  content = content.replace(/from "(\.\/[^"]+)"/g, (match, specifier) =>
    specifier.endsWith(".js") ? match : `from "${specifier}.js"`,
  );
  fs.writeFileSync(filePath, content);
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.resolve(__dirname, "../../src/styles/tailwind.css");
const css = fs.readFileSync(cssPath, "utf8");

test("desktop shell stays transparent so glass sidebars can reveal apps behind the window", () => {
  assert.match(css, /\.desktop-shell\s*\{[\s\S]*background:\s*transparent;/);
  assert.doesNotMatch(css, /\.desktop-shell\s*\{[\s\S]*background:\s*var\(--panel-bg\)/);
});

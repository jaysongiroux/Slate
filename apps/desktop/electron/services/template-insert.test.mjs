import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

test("slash menu wiring includes insert from template and appends selected template content", async () => {
  const [editorSource, pickerSource, templateLoaderSource] = await Promise.all([
    readFile(path.join(appRoot, "src/components/NovelEditor.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/components/TemplateInsertPicker.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/lib/template-content.ts"), "utf8"),
  ]);

  assert.match(editorSource, /Insert from template/);
  assert.match(editorSource, /listTemplates/);
  assert.match(editorSource, /loadTemplateTiptapContent/);
  assert.match(editorSource, /insertContentAt/);
  assert.match(editorSource, /TemplateInsertPicker/);
  assert.match(pickerSource, /Search templates/);
  assert.match(templateLoaderSource, /getDatabase/);
});

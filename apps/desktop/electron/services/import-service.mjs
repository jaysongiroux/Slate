import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function extractTitle(markdown, filename) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : filename;
}

function toVirtualPath(relativeFsPath) {
  return relativeFsPath.replace(/\\/g, "/").replace(/\.md$/i, "");
}

function isTemplatePath(relativeFsPath) {
  const normalized = relativeFsPath.replace(/\\/g, "/");
  return normalized.startsWith("templates/") || normalized.includes("/templates/");
}

export class ImportService {
  constructor({ noteStore, httpClient = null }) {
    this._noteStore = noteStore;
    this._httpClient = httpClient;
  }

  /**
   * Recursively scans a directory for .md files.
   * Returns array of { absolutePath, relativePath, isTemplate, filename }.
   */
  async scanDirectory(dirPath) {
    const results = [];

    async function walk(currentPath, relativeBase) {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const relativeFsPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(fullPath, relativeFsPath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          results.push({
            absolutePath: fullPath,
            relativePath: toVirtualPath(relativeFsPath),
            filename: entry.name.replace(/\.md$/i, ""),
            isTemplate: isTemplatePath(relativeFsPath),
          });
        }
      }
    }

    await walk(dirPath, "");
    return results;
  }

  /**
   * Imports all .md files from a directory into the note store.
   * Returns { total, imported, errors }.
   */
  async importDirectory(dirPath) {
    const files = await this.scanDirectory(dirPath);
    const total = files.length;
    let imported = 0;
    const errors = [];
    const importedNotes = [];

    for (const file of files) {
      try {
        let markdown = "";
        try {
          markdown = await fs.readFile(file.absolutePath, "utf-8");
        } catch {
          markdown = "";
        }

        const title = extractTitle(markdown, file.filename);
        const plainText = markdown
          .replace(/[#*_`~\[\]()>|-]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const id = crypto.randomUUID();

        const note = this._noteStore.upsertFromImport({
          id,
          path: file.relativePath,
          title,
          isTemplate: file.isTemplate,
        });

        this._noteStore.updatePlainText(note.id, plainText);

        importedNotes.push({
          id: note.id,
          path: note.path,
          title,
          markdown,
          plainText,
        });
        imported++;
      } catch (err) {
        errors.push({ path: file.relativePath, error: err.message });
      }
    }

    // If online, batch-sync to backend
    if (this._httpClient && importedNotes.length > 0) {
      try {
        await this._httpClient.importNotesRemote(
          importedNotes.map(({ id, path, title, markdown, plainText }) => ({
            id,
            path,
            title,
            markdown,
            plainText,
          })),
        );
      } catch (err) {
        console.warn("[ImportService] backend sync failed (non-fatal):", err.message);
      }
    }

    return { total, imported, errors };
  }
}

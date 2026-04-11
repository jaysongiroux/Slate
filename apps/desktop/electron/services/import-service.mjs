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
  /** @param {{ noteStore?: object | null; httpClient?: object | null }} opts */
  constructor({ noteStore = null, httpClient = null } = {}) {
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
   * Imports an array of absolute .md file paths into the note store.
   * Returns { total, imported, errors }.
   */
  async importFiles(filePaths) {
    const files = filePaths.map((absolutePath) => {
      const filename = path.basename(absolutePath).replace(/\.md$/i, "");
      return {
        absolutePath,
        relativePath: filename,
        filename,
        isTemplate: false,
      };
    });
    return this._importFileList(files);
  }

  /**
   * Imports all .md files from a directory into the note store.
   * Returns { total, imported, errors }.
   */
  async importDirectory(dirPath) {
    const files = await this.scanDirectory(dirPath);
    return this._importFileList(files);
  }

  async _importFileList(files) {
    const total = files.length;
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

        importedNotes.push({
          id,
          path: file.relativePath,
          title,
          markdown,
          plainText,
          isTemplate: file.isTemplate,
        });
      } catch (err) {
        errors.push({ path: file.relativePath, error: err.message });
      }
    }

    // If online, sync to backend first.
    // HTTP errors (401, 500, etc.) are fatal — nothing is written locally.
    // Connection errors (backend unreachable) fall through to local-only import.
    if (this._httpClient && importedNotes.length > 0) {
      try {
        const response = await this._httpClient.importNotesRemote(
          importedNotes.map(({ id, path, title, markdown, plainText }) => ({
            id,
            path,
            title,
            markdown,
            plainText,
          })),
        );
        if (response?.created) {
          for (const backendNote of response.created) {
            const local = importedNotes.find((n) => n.id === backendNote.id);
            if (local) local.path = backendNote.path;
          }
        }
      } catch (err) {
        if (err.status) throw err;
        console.warn("[ImportService] backend unreachable, importing locally:", err.message);
      }
    }

    // Write to local store only after backend sync succeeds (legacy main-process store).
    let imported = 0;
    if (this._noteStore) {
      for (const note of importedNotes) {
        const stored = this._noteStore.upsertFromImport({
          id: note.id,
          path: note.path,
          title: note.title,
          isTemplate: note.isTemplate,
        });
        this._noteStore.updatePlainText(stored.id, note.plainText);
        imported++;
      }
    } else {
      imported = importedNotes.length;
    }

    const errorCount = errors.length;
    const base = { total, imported, errors: errorCount };
    if (!this._noteStore && importedNotes.length > 0) {
      return { ...base, notes: importedNotes };
    }
    return base;
  }
}

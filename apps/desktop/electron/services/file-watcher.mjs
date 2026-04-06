import { watch } from "chokidar";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";

export class FileWatcher {
  constructor({ metadataStore, onExternalChange }) {
    this.metadataStore = metadataStore;
    this.onExternalChange = onExternalChange;
    this.selfWriteHashes = new Map(); // filePath -> md5 hash
    this.watcher = null;
  }

  start(workspaceRoot) {
    if (this.watcher) {
      this.watcher.close();
    }

    this.watcher = watch(join(workspaceRoot, "**/*.md"), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher.on("change", async (filePath) => {
      try {
        const content = await readFile(filePath, "utf-8");
        if (!this.isExternalChange(filePath, content)) {
          return;
        }
        this.handleFileChange(filePath, content);
      } catch (err) {
        if (err.code !== "ENOENT") {
          console.error("[FileWatcher] Error reading changed file:", err);
        }
      }
    });
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  recordSelfWrite(filePath, content) {
    this.selfWriteHashes.set(filePath, this.hash(content));
  }

  isExternalChange(filePath, content) {
    const lastHash = this.selfWriteHashes.get(filePath);
    if (!lastHash) return true;
    return this.hash(content) !== lastHash;
  }

  handleFileChange(filePath, content) {
    const autoReconcile = this.metadataStore.getSetting(
      "autoReconcileFilesystem",
      false,
    );
    this.onExternalChange({ filePath, content, autoReconcile });
  }

  hash(content) {
    return createHash("md5").update(content).digest("hex");
  }
}

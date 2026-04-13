import fs from "node:fs";
import path from "node:path";

export class PendingUploads {
  #filePath;
  #stagingDir;
  #queue;

  constructor(userDataPath) {
    this.#stagingDir = path.join(userDataPath, "pending-attachments");
    fs.mkdirSync(this.#stagingDir, { recursive: true });
    this.#filePath = path.join(userDataPath, "pending-uploads.json");
    this.#queue = this.#load();
  }

  #load() {
    try {
      return JSON.parse(fs.readFileSync(this.#filePath, "utf-8"));
    } catch {
      return [];
    }
  }

  #save() {
    fs.writeFileSync(this.#filePath, JSON.stringify(this.#queue, null, 2));
  }

  get stagingDir() {
    return this.#stagingDir;
  }

  add(entry) {
    this.#queue.push({
      ...entry,
      retries: 0,
      createdAt: new Date().toISOString(),
    });
    this.#save();
  }

  list() {
    return [...this.#queue];
  }

  remove(id) {
    this.#queue = this.#queue.filter((e) => e.id !== id);
    this.#save();
  }

  incrementRetries(id) {
    const entry = this.#queue.find((e) => e.id === id);
    if (entry) {
      entry.retries += 1;
      this.#save();
    }
  }
}

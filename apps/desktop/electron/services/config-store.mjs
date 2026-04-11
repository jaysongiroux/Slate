import fs from "node:fs";
import path from "node:path";

export class ConfigStore {
  #filePath;
  #data;

  constructor(userDataPath) {
    fs.mkdirSync(userDataPath, { recursive: true });
    this.#filePath = path.join(userDataPath, "config.json");
    this.#data = this.#load();
  }

  #load() {
    try {
      return JSON.parse(fs.readFileSync(this.#filePath, "utf-8"));
    } catch {
      return {};
    }
  }

  #save() {
    fs.writeFileSync(this.#filePath, JSON.stringify(this.#data, null, 2));
  }

  get(key) {
    return this.#data[key] ?? null;
  }

  set(key, value) {
    this.#data[key] = value;
    this.#save();
  }

  delete(key) {
    delete this.#data[key];
    this.#save();
  }

  getAll() {
    return { ...this.#data };
  }
}

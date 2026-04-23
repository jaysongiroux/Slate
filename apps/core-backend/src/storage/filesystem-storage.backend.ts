import { createReadStream, type Dirent } from "node:fs";
import { mkdir, readdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve as resolvePath, sep } from "node:path";
import { Readable } from "node:stream";
import type { StorageBackend, StorageObjectMetadata } from "./storage-backend.interface";

export class FilesystemStorageBackend implements StorageBackend {
  private readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = resolvePath(rootPath);
  }

  private resolve(key: string): string {
    return join(this.rootPath, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const filePath = this.resolve(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
  }

  async get(key: string): Promise<Readable> {
    return createReadStream(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolve(key);
    try {
      await unlink(filePath);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    await this.pruneEmptyAncestors(dirname(filePath));
  }

  private async pruneEmptyAncestors(startDir: string): Promise<void> {
    let current = resolvePath(startDir);
    while (true) {
      const rel = relative(this.rootPath, current);
      if (rel === "" || rel.startsWith("..")) return; // never climb out of or remove the root
      try {
        await rmdir(current);
      } catch (error: any) {
        if (error.code === "ENOTEMPTY" || error.code === "EEXIST" || error.code === "ENOENT") {
          return;
        }
        throw error;
      }
      current = dirname(current);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async pruneEmptyDirectories(): Promise<number> {
    let removed = 0;
    const walk = async (dir: string): Promise<boolean> => {
      let entries: Dirent[];
      try {
        entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
      } catch (error: any) {
        if (error.code === "ENOENT") return true; // vanished — treat as empty
        throw error;
      }

      let allChildrenRemoved = true;
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const childRemoved = await walk(join(dir, entry.name));
          if (!childRemoved) allChildrenRemoved = false;
        } else {
          allChildrenRemoved = false;
        }
      }

      if (!allChildrenRemoved) return false;

      // Never remove the storage root itself.
      const rel = relative(this.rootPath, dir);
      if (rel === "" || rel.startsWith("..")) return false;

      try {
        await rmdir(dir);
        removed++;
        return true;
      } catch (error: any) {
        if (error.code === "ENOTEMPTY" || error.code === "EEXIST") return false;
        if (error.code === "ENOENT") return true;
        throw error;
      }
    };

    try {
      await walk(this.rootPath);
    } catch {
      // Swallow unexpected errors so one bad subtree doesn't abort the whole sweep.
    }
    return removed;
  }

  async listKeys(prefix: string): Promise<StorageObjectMetadata[]> {
    const dir = this.resolve(prefix);
    let entries: Dirent[];
    try {
      entries = (await readdir(dir, { recursive: true, withFileTypes: true })) as Dirent[];
    } catch {
      return [];
    }

    const results: StorageObjectMetadata[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parentPath =
        (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
        (entry as unknown as { path?: string }).path ??
        dir;
      const absolute = join(parentPath, entry.name);
      const relative = absolute.slice(this.rootPath.length).replace(/^[\\/]+/, "");
      const key = relative.split(sep).join(posix.sep);
      try {
        const info = await stat(absolute);
        results.push({ key, mtime: info.mtime });
      } catch {
        // File disappeared between readdir and stat — skip
      }
    }
    return results;
  }
}

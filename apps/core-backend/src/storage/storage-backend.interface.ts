import { Readable } from "node:stream";

export type StorageObjectMetadata = { key: string; mtime: Date };

export interface StorageBackend {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  listKeys(prefix: string): Promise<StorageObjectMetadata[]>;
  pruneEmptyDirectories(): Promise<number>;
}

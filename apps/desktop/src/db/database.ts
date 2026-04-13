import {
  createRxDatabase,
  addRxPlugin,
  type RxDatabase,
  type RxCollection,
  type RxStorage,
} from "rxdb";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { noteSchema, type NoteDocType } from "./schemas/note.schema";
import { folderSchema, type FolderDocType } from "./schemas/folder.schema";
import { settingSchema, type SettingDocType } from "./schemas/setting.schema";

const isDev = import.meta.env.DEV;
if (isDev) {
  addRxPlugin(RxDBDevModePlugin);
}

function getStorage(): RxStorage<any, any> {
  const storage = getRxStorageDexie();
  return isDev ? wrappedValidateAjvStorage({ storage }) : storage;
}

export type SlateCollections = {
  notes: RxCollection<NoteDocType>;
  folders: RxCollection<FolderDocType>;
  settings: RxCollection<SettingDocType>;
};

export type SlateDatabase = RxDatabase<SlateCollections>;

let dbPromise: Promise<SlateDatabase> | null = null;

export function getDatabase(): Promise<SlateDatabase> {
  if (!dbPromise) {
    dbPromise = createDatabase();
  }
  return dbPromise;
}

async function createDatabase(): Promise<SlateDatabase> {
  const db = await createRxDatabase<SlateCollections>({
    name: "slatedb",
    storage: getStorage(),
    ignoreDuplicate: true,
  });

  await db.addCollections({
    notes: { schema: noteSchema },
    folders: { schema: folderSchema },
    settings: { schema: settingSchema },
  });

  return db;
}

export async function destroyDatabase(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    await db.remove();
    dbPromise = null;
  }
}

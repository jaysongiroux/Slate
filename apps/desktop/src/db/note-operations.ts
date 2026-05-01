import { v4 as uuidv4 } from "uuid";
import type { SlateDatabase } from "./database";
import type { NoteDocType } from "./schemas/note.schema";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function todayPath(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isIsoDateTitle(title: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(title.trim());
}

function parentFolderPath(notePath: string): string | null {
  const normalized = notePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : null;
}

async function ensureFolder(
  db: SlateDatabase,
  folderPath: string | null | undefined,
): Promise<void> {
  if (!folderPath) return;

  const existing = await db.folders.findOne({ selector: { path: folderPath } }).exec();
  if (existing) return;

  const now = new Date().toISOString();
  await db.folders.insert({
    id: uuidv4(),
    path: folderPath,
    updatedAt: now,
    createdAt: now,
  });
}

export async function createNote(
  db: SlateDatabase,
  parentPath: string | undefined,
  title: string,
): Promise<NoteDocType> {
  const id = uuidv4();
  const slug = slugify(title) || id;
  const path = parentPath ? `${parentPath}/${slug}` : slug;
  const now = new Date().toISOString();

  const doc: NoteDocType = {
    id,
    title,
    path,
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
        { type: "paragraph" },
      ],
    },
    markdown: `# ${title}\n`,
    pinned: false,
    isDeleted: false,
    isTemplate: false,
    updatedAt: now,
    createdAt: now,
  };

  // Reject if a live note already occupies this path
  const existing = await db.notes.findOne({ selector: { path, isDeleted: false } }).exec();
  if (existing) {
    throw new Error(`A note already exists at "${path}"`);
  }

  // Drop soft-deleted rows at this path so a new note never shares a path slot with a ghost
  // (stale saves could otherwise revive the old doc and surface its content).
  const ghosts = await db.notes.find({ selector: { path, isDeleted: true } }).exec();
  for (const ghost of ghosts) {
    await ghost.remove();
  }

  await ensureFolder(db, parentPath);
  await db.notes.insert(doc);
  return doc;
}

export async function createTemplate(
  db: SlateDatabase,
  title: string,
  parentUnderTemplates?: string,
): Promise<NoteDocType> {
  const id = uuidv4();
  const slug = slugify(title) || id;
  const now = new Date().toISOString();

  let basePath = "templates";
  const parent = parentUnderTemplates?.replace(/\\/g, "/").replace(/\/+$/, "") ?? "";
  if (parent === "templates" || parent.startsWith("templates/")) {
    basePath = parent;
  }

  const path = `${basePath}/${slug}`;
  const doc: NoteDocType = {
    id,
    title,
    path,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    markdown: "",
    pinned: false,
    isDeleted: false,
    isTemplate: true,
    updatedAt: now,
    createdAt: now,
  };

  const ghosts = await db.notes.find({ selector: { path, isDeleted: true } }).exec();
  for (const ghost of ghosts) {
    await ghost.remove();
  }

  await ensureFolder(db, basePath);
  await db.notes.insert(doc);
  return doc;
}

export async function createDailyNote(
  db: SlateDatabase,
  parentPath?: string,
): Promise<NoteDocType> {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const title = `${yyyy}-${mm}-${dd}`;
  const path = parentPath ? `${parentPath}/${title}` : todayPath();

  const existing = await db.notes.findOne({ selector: { path, isDeleted: false } }).exec();
  if (existing) {
    const j = existing.toJSON();
    const segment = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
    if (isIsoDateTitle(segment) && !isIsoDateTitle(j.title)) {
      const now = new Date().toISOString();
      await existing.patch({ title: segment, updatedAt: now });
      return { ...j, title: segment, updatedAt: now };
    }
    return j;
  }

  const ghosts = await db.notes.find({ selector: { path, isDeleted: true } }).exec();
  for (const ghost of ghosts) {
    await ghost.remove();
  }

  return createNote(db, parentPath, title);
}

export async function deleteNote(db: SlateDatabase, noteId: string): Promise<void> {
  const doc = await db.notes.findOne({ selector: { id: noteId } }).exec();
  if (doc) {
    await ensureFolder(db, parentFolderPath(doc.path));
    await doc.patch({ isDeleted: true, updatedAt: new Date().toISOString() });
  }
}

export async function renameNote(
  db: SlateDatabase,
  noteId: string,
  newTitle: string,
): Promise<void> {
  const doc = await db.notes.findOne({ selector: { id: noteId } }).exec();
  if (doc) {
    const oldPath = doc.path;
    const parentDir = oldPath.includes("/") ? oldPath.substring(0, oldPath.lastIndexOf("/")) : "";
    const newSlug = slugify(newTitle) || noteId;
    const newPath = parentDir ? `${parentDir}/${newSlug}` : newSlug;

    await doc.patch({
      title: newTitle,
      path: newPath,
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function moveNote(
  db: SlateDatabase,
  noteId: string,
  targetFolderPath: string,
): Promise<void> {
  const doc = await db.notes.findOne({ selector: { id: noteId } }).exec();
  if (doc) {
    const fileName = doc.path.includes("/")
      ? doc.path.substring(doc.path.lastIndexOf("/") + 1)
      : doc.path;
    const newPath = targetFolderPath ? `${targetFolderPath}/${fileName}` : fileName;

    await ensureFolder(db, targetFolderPath);
    await doc.patch({ path: newPath, updatedAt: new Date().toISOString() });
  }
}

export async function togglePinNote(
  db: SlateDatabase,
  noteId: string,
  pinned: boolean,
): Promise<void> {
  const doc = await db.notes.findOne({ selector: { id: noteId } }).exec();
  if (doc) {
    await doc.patch({ pinned, updatedAt: new Date().toISOString() });
  }
}

export async function loadNote(db: SlateDatabase, noteId: string): Promise<NoteDocType | null> {
  const doc = await db.notes.findOne({ selector: { id: noteId } }).exec();
  return doc ? doc.toJSON() : null;
}

export async function createFolder(
  db: SlateDatabase,
  parentPath: string | undefined,
  name: string,
): Promise<string> {
  const id = uuidv4();
  const path = parentPath ? `${parentPath}/${name}` : name;
  const now = new Date().toISOString();

  await db.folders.insert({
    id,
    path,
    updatedAt: now,
    createdAt: now,
  });

  return path;
}

export async function deleteFolder(db: SlateDatabase, folderPath: string): Promise<void> {
  // Soft-delete all notes in this folder
  const notesInFolder = await db.notes
    .find({
      selector: {
        path: { $regex: `^${folderPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/` },
        isDeleted: false,
      },
    })
    .exec();

  for (const note of notesInFolder) {
    await note.patch({ isDeleted: true, updatedAt: new Date().toISOString() });
  }

  // Remove the folder record
  const folder = await db.folders.findOne({ selector: { path: folderPath } }).exec();
  if (folder) {
    await folder.remove();
  }

  // Remove child folders
  const childFolders = await db.folders
    .find({
      selector: {
        path: { $regex: `^${folderPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/` },
      },
    })
    .exec();

  for (const child of childFolders) {
    await child.remove();
  }
}

export async function renameFolder(
  db: SlateDatabase,
  folderPath: string,
  newName: string,
): Promise<void> {
  const parentDir = folderPath.includes("/")
    ? folderPath.substring(0, folderPath.lastIndexOf("/"))
    : "";
  const newPath = parentDir ? `${parentDir}/${newName}` : newName;

  // Update folder record
  const folder = await db.folders.findOne({ selector: { path: folderPath } }).exec();
  if (folder) {
    await folder.patch({ path: newPath, updatedAt: new Date().toISOString() });
  }

  // Update all notes in this folder
  const notesInFolder = await db.notes
    .find({
      selector: {
        path: { $regex: `^${folderPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/` },
      },
    })
    .exec();

  for (const note of notesInFolder) {
    const updatedPath = note.path.replace(folderPath, newPath);
    await note.patch({ path: updatedPath, updatedAt: new Date().toISOString() });
  }
}

export async function moveFolder(
  db: SlateDatabase,
  folderPath: string,
  targetParentPath: string,
): Promise<void> {
  const folderName = folderPath.includes("/")
    ? folderPath.substring(folderPath.lastIndexOf("/") + 1)
    : folderPath;
  const newPath = targetParentPath ? `${targetParentPath}/${folderName}` : folderName;
  if (newPath === folderPath) return;

  const now = new Date().toISOString();
  const childPrefixRegex = `^${folderPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`;
  const prefixLen = folderPath.length + 1;

  const folder = await db.folders.findOne({ selector: { path: folderPath } }).exec();
  if (folder) {
    await folder.patch({ path: newPath, updatedAt: now });
  }

  const childFolders = await db.folders
    .find({ selector: { path: { $regex: childPrefixRegex } } })
    .exec();
  for (const child of childFolders) {
    await child.patch({ path: `${newPath}/${child.path.slice(prefixLen)}`, updatedAt: now });
  }

  const notesInFolder = await db.notes
    .find({ selector: { path: { $regex: childPrefixRegex } } })
    .exec();
  for (const note of notesInFolder) {
    await note.patch({ path: `${newPath}/${note.path.slice(prefixLen)}`, updatedAt: now });
  }

  await ensureFolder(db, targetParentPath || undefined);
}

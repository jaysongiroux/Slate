import type { LocalNoteSummary } from "@slate/shared";

export type NoteTreeNode = {
  name: string;
  path: string;
  folders: NoteTreeNode[];
  notes: LocalNoteSummary[];
};

type MutableTreeNode = {
  name: string;
  path: string;
  folders: MutableTreeNode[];
  notes: LocalNoteSummary[];
  folderMap: Map<string, MutableTreeNode>;
};

/** Normalize stored paths so tree layout matches on Windows (`\`) and mixed slashes. */
export function normalizeNotePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export function basename(notePath: string) {
  const normalized = normalizeNotePath(notePath);
  const name = normalized.split("/").pop() ?? normalized;
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

/** True for the `templates` folder and any subfolder path under it. */
export function isUnderTemplatesFolder(folderPath: string): boolean {
  const p = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return p === "templates" || p.startsWith("templates/");
}

/** Notes shown in the template insert picker: explicit template flag or any doc under `templates/`. */
export function isTemplateLibraryEntry(note: {
  path: string;
  isTemplate: boolean;
  isDeleted: boolean;
}): boolean {
  if (note.isDeleted) return false;
  if (note.isTemplate) return true;
  return normalizeNotePath(note.path).startsWith("templates/");
}

export function buildNoteTree(
  notes: LocalNoteSummary[],
  folderPaths: string[] = [],
): NoteTreeNode[] {
  const root: MutableTreeNode = {
    name: "",
    path: "",
    folders: [],
    notes: [],
    folderMap: new Map(),
  };

  function ensureFolder(folderPath: string): MutableTreeNode {
    const segments = folderPath.split("/").filter(Boolean);
    let current = root;
    let currentPath = "";

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let node = current.folderMap.get(segment);
      if (!node) {
        node = { name: segment, path: currentPath, folders: [], notes: [], folderMap: new Map() };
        current.folderMap.set(segment, node);
        current.folders.push(node);
      }
      current = node;
    }

    return current;
  }

  for (const folderPath of folderPaths) {
    ensureFolder(normalizeNotePath(folderPath));
  }

  for (const note of notes) {
    const segments = normalizeNotePath(note.path).split("/").filter(Boolean);
    const folders = segments.slice(0, -1);
    const parent = folders.length > 0 ? ensureFolder(folders.join("/")) : root;
    parent.notes.push(note);
  }

  function finalize(node: MutableTreeNode): NoteTreeNode {
    return {
      name: node.name,
      path: node.path,
      folders: node.folders.map(finalize).sort((a, b) => a.name.localeCompare(b.name)),
      notes: node.notes.slice().sort((a, b) => basename(a.path).localeCompare(basename(b.path))),
    };
  }

  const finalizedRoot = finalize(root);
  return finalizedRoot.folders.length || finalizedRoot.notes.length ? [finalizedRoot] : [];
}
